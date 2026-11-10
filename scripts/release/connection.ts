import z from 'zod';

import { ConfigStore, homePath, readSettingsFile } from '../infra/config.ts';
import { InfraFailure } from '../infra/errors.ts';
import { ReleaseRepositorySchema } from '../release-metadata.ts';

export async function releaseConnection(
  root: string,
  configDirectory: string,
  overrides: NodeJS.ProcessEnv = process.env,
) {
  const store = new ConfigStore({ repositoryRoot: root, configDirectory });
  const release = await store.readEnvironment('release');
  const releaseEnvironment = { ...release.values };

  for (const key of ['TCG_DEPLOY_HOST', 'TCG_DEPLOY_KEY', 'TCG_KNOWN_HOSTS', 'TCG_IMAGE_REPOSITORY']) {
    releaseEnvironment[key] = overrides[key] ?? release.values[key] ?? '';
  }

  const settings = z
    .object({
      TCG_DEPLOY_HOST: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/),
      TCG_DEPLOY_KEY: z.string().nonempty(),
      TCG_KNOWN_HOSTS: z.string().nonempty(),
      TCG_IMAGE_REPOSITORY: ReleaseRepositorySchema,
    })
    .safeParse(releaseEnvironment);

  if (!settings.success) {
    throw new InfraFailure('Release settings are missing or invalid. Run just setup-infra first.');
  }

  const environment = {
    ...process.env,
    ...releaseEnvironment,
    ...settings.data,
    TCG_RELEASE_ENV_FILE: store.paths.release,
  };

  environment.TCG_DEPLOY_KEY = homePath(settings.data.TCG_DEPLOY_KEY);
  environment.TCG_KNOWN_HOSTS = homePath(settings.data.TCG_KNOWN_HOSTS);
  const key = await readSettingsFile(environment.TCG_DEPLOY_KEY);
  const hosts = await readSettingsFile(environment.TCG_KNOWN_HOSTS);

  if (!key || !hosts) {
    throw new InfraFailure('Deployment key or verified known_hosts is missing. Run just setup-infra.');
  }

  return { store, release, releaseEnvironment, settings: settings.data, environment, key, hosts };
}
