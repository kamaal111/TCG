import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';

import { gitRemoteUrl } from '../git.ts';
import { ReleaseRepositorySchema } from '../release-metadata.ts';
import { type ConfigStore, homePath } from './config.ts';
import type { EnvironmentDocument, TerraformDocument, TerraformValues } from './config.ts';
import { askCredential, credentialNext, credentials, shellQuote } from './credentials.ts';
import { databaseSizeChoices, DigitalOcean, dropletSizeChoices, type Choice } from './digitalocean.ts';
import { failure, InfraFailure } from './errors.ts';
import type { Prompts } from './prompts.ts';

interface WizardOptions {
  store: ConfigStore;
  prompts: Prompts;
  repositoryRoot: string;
  request?: typeof fetch;
}

interface TextOptions {
  prompts: Prompts;
  message: string;
  initialValue?: string;
  help?: string;
  valid?: (value: string) => boolean;
  error?: string;
}

async function text({ prompts, message, initialValue, help, valid, error }: TextOptions): Promise<string> {
  if (help) {
    prompts.note(help);
  }

  while (true) {
    const value = (await prompts.text({ message, initialValue })).trim();

    if (value && !/[\r\n\0`]/.test(value) && (!valid || valid(value))) {
      return value;
    }

    prompts.note(error ?? 'Enter a valid single-line value.');
  }
}

function split(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ];
}

function administratorList(value: string): boolean {
  return (
    split(value).length > 0 &&
    split(value).every(cidr => {
      const [address = '', bits = ''] = cidr.split('/');

      return (
        cidr.split('/').length === 2 &&
        net.isIP(address) === 4 &&
        /^\d+$/.test(bits) &&
        Number(bits) >= 24 &&
        Number(bits) <= 32
      );
    })
  );
}

function clientList(value: string): boolean {
  return split(value).every(address => net.isIP(address) === 4 && address !== '0.0.0.0');
}

function host(value: string): boolean {
  return net.isIP(value) !== 0 || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value);
}

function publicKey(value: string): string | undefined {
  const match = /^(ssh-ed25519) ([A-Za-z0-9+/]{68})(?:\s.*)?$/.exec(value.trim());

  if (!match?.[2]) {
    return undefined;
  }

  const encoded = Buffer.from(match[2], 'base64');

  if (
    encoded.length !== 51 ||
    encoded.readUInt32BE(0) !== 11 ||
    encoded.subarray(4, 15).toString() !== 'ssh-ed25519' ||
    encoded.readUInt32BE(15) !== 32
  ) {
    return undefined;
  }

  return `ssh-ed25519 ${match[2]}`;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function savedOptions(options: Choice[], saved: string | undefined, label: string): Choice[] {
  if (!saved || options.some(option => option.value === saved)) {
    return options;
  }

  return [...options, { value: saved, label: `${label} — saved, not returned by provider`, hint: 'saved' }];
}

async function saveFields(
  store: ConfigStore,
  document: EnvironmentDocument,
  changes: Record<string, string>,
): Promise<EnvironmentDocument> {
  await store.saveEnvironment(document, changes);

  return {
    ...document,
    ...(await store.readEnvironment(document.file === store.paths.infrastructure ? 'infrastructure' : 'release')),
  };
}

async function setupResources(
  { store, prompts, request }: WizardOptions,
  environment: EnvironmentDocument,
): Promise<boolean> {
  const document = await store.readTerraform();

  if (document.values && !(await prompts.confirm('Review resource settings and capacity?', true))) {
    return true;
  }

  while (true) {
    try {
      await collectResources({ store, prompts, request, document, token: environment.values.DIGITALOCEAN_TOKEN ?? '' });

      return Boolean((await store.readTerraform()).values);
    } catch (error) {
      if (!(error instanceof InfraFailure) || error.exitCode === 130) {
        throw error;
      }

      prompts.note(error.message);

      const action = await prompts.select({
        message: 'Resource lookup could not finish',
        options: [
          { value: 'retry', label: 'Retry resource lookup' },
          { value: 'keep', label: document.values ? 'Keep saved resource settings' : 'Finish resource settings later' },
        ],
        initialValue: 'keep',
      });

      if (action === 'keep') {
        return Boolean(document.values);
      }
    }
  }
}

interface CollectResourcesOptions {
  store: ConfigStore;
  prompts: Prompts;
  request?: typeof fetch;
  document: TerraformDocument;
  token: string;
}

async function collectResources({ store, prompts, request, document, token }: CollectResourcesOptions): Promise<void> {
  const provider = new DigitalOcean({ token, request });
  prompts.note(
    'Looking up existing resources. This makes read-only requests and does not change infrastructure.',
    '7/8 · Resource settings',
  );

  const [droplets, databases, vpcs, regions, sizes, options] = await Promise.all([
    provider.droplets(),
    provider.databases(),
    provider.vpcs(),
    provider.regions(),
    provider.sizes(),
    provider.databaseOptions(),
  ]);

  if (!droplets.length || !databases.length) {
    failure('No existing Droplet or PostgreSQL cluster was found. Check your DigitalOcean account.');
  }

  const previous = document.values;

  const dropletId = await prompts.select({
    message: 'Existing Droplet',
    options: savedOptions(
      droplets.map(item => ({
        value: String(item.id),
        label: `${item.name} — ${regions.find(region => region.slug === item.region.slug)?.name ?? item.region.slug}`,
      })),
      previous?.existing_droplet_id,
      'Saved Droplet',
    ),
    initialValue: previous?.existing_droplet_id,
  });

  const databaseId = await prompts.select({
    message: 'Existing PostgreSQL cluster',
    options: savedOptions(
      databases.map(item => ({ value: item.id, label: `${item.name} — PostgreSQL ${item.version}` })),
      previous?.existing_database_id,
      'Saved database',
    ),
    initialValue: previous?.existing_database_id,
  });

  if (previous && (dropletId !== previous.existing_droplet_id || databaseId !== previous.existing_database_id)) {
    failure(
      'Changing the identity of managed resources needs a separate Terraform state migration. Keep these resources and edit their capacity instead.',
    );
  }

  const droplet = droplets.find(item => String(item.id) === dropletId);
  const database = databases.find(item => item.id === databaseId);

  if (!droplet || !database) {
    failure(
      'The saved resources were not returned by this account. Check your account and token; the settings were preserved.',
    );
  }

  if (
    droplet.region.slug !== database.region ||
    !droplet.vpc_uuid ||
    droplet.vpc_uuid !== database.private_network_uuid
  ) {
    failure('The Droplet and database must share the same region and VPC. No resource settings were saved.');
  }

  const [clients, logicalDatabases] = await Promise.all([
    provider.trustedClients({ database: database.id, droplet: droplet.id }),
    provider.logicalDatabases(database.id),
  ]);

  const current = previous?.configuration;

  if (
    current &&
    (current.region !== droplet.region.slug ||
      current.droplet.vpc_uuid !== droplet.vpc_uuid ||
      current.database.vpc_uuid !== database.private_network_uuid)
  ) {
    failure(
      'Saved region or VPC settings differ from the running resources. Review that migration manually; the settings were preserved.',
    );
  }

  prompts.note(
    `Region: ${regions.find(item => item.slug === droplet.region.slug)?.name ?? droplet.region.slug}\nPrivate network: ${vpcs.find(item => item.id === droplet.vpc_uuid)?.name ?? 'Shared VPC'}\nThe existing server must run Debian 13 on x86_64. In its console, check cat /etc/os-release and uname -m. Setting an image here does not reinstall its OS.`,
  );

  const name = await text({
    prompts,
    message: 'Environment name',
    initialValue: current?.name ?? 'tcg-production',
    valid: value => /^[a-z][a-z0-9-]{2,40}$/.test(value),
    error: 'Use 3–41 lowercase letters, digits, and hyphens, beginning with a letter.',
  });

  const dropletName = await text({
    prompts,
    message: 'Droplet name',
    initialValue: current?.droplet.name ?? droplet.name,
  });

  const dropletChoices = dropletSizeChoices({
    sizes,
    saved: current?.droplet.size ?? droplet.size.slug,
    running: droplet.size.slug,
    region: droplet.region.slug,
    disk: droplet.disk,
  });

  const dropletSize = await prompts.select({
    message: 'Droplet size',
    options: dropletChoices,
    initialValue: current?.droplet.size ?? droplet.size.slug,
  });

  const databaseName = await text({
    prompts,
    message: 'Database cluster name',
    initialValue: current?.database.name ?? database.name,
    help: 'This is the cluster name, separate from the logical application database.',
  });

  const databaseChoices = databaseSizeChoices({
    slugs: [...new Set(options.layouts.flatMap(layout => layout.sizes))],
    saved: current?.database.size ?? database.size,
    running: database.size,
  });

  const databaseSize = await prompts.select({
    message: 'Database size',
    options: databaseChoices,
    initialValue: current?.database.size ?? database.size,
  });

  const counts = new Set(
    options.layouts.filter(layout => layout.sizes.includes(databaseSize)).map(layout => layout.num_nodes),
  );

  const savedCount = current?.database.node_count ?? database.num_nodes;

  if (databaseSize === (current?.database.size ?? database.size)) {
    counts.add(savedCount);
  }

  if (counts.size === 0) {
    failure('No supported database node layout was returned for this plan. Keep the current settings.');
  }

  const countOptions = [...counts]
    .toSorted((a, b) => a - b)
    .map(count => ({
      value: String(count),
      label:
        count === 1
          ? 'One primary node, no standby nodes'
          : `One primary node, ${count - 1} standby ${count === 2 ? 'node' : 'nodes'}`,
    }));

  const nodeCount = Number(
    await prompts.select({
      message: 'Database nodes',
      options: countOptions,
      initialValue: counts.has(savedCount) ? String(savedCount) : undefined,
    }),
  );

  const versions = [...new Set([...options.versions, current?.database.version ?? database.version])];

  const version = await prompts.select({
    message: 'PostgreSQL version',
    options: versions.map(value => ({ value, label: `PostgreSQL ${value}` })),
    initialValue: current?.database.version ?? database.version,
  });

  const applicationDatabase = await prompts.select({
    message: 'Application database',
    options: savedOptions(logicalDatabases, current?.application_database, 'Saved application database'),
    initialValue: current?.application_database ?? 'defaultdb',
  });

  const admin = await text({
    prompts,
    message: 'Administrator IPv4 CIDRs (comma separated)',
    initialValue: current?.admin_ipv4_cidrs.join(', '),
    help: 'On the Mac mini run: curl -4 https://api.ipify.org\nAppend /32 to that PUBLIC outbound IPv4. Keep other administrator addresses you need.',
    valid: administratorList,
    error: 'Enter IPv4 CIDRs such as 192.0.2.10/32, with prefixes /24 through /32.',
  });

  const initialClients = [...new Set([...(current?.database_client_ipv4s ?? []), ...clients])];

  const clientInput = await prompts.text({
    message: 'External database client IPv4s (comma separated, no /32)',
    initialValue: initialClients.join(', '),
  });

  if (!clientList(clientInput)) {
    failure(
      'Database clients must be explicit IPv4 addresses without CIDR suffixes. Resource settings were not saved.',
    );
  }

  const bucket = await text({
    prompts,
    message: 'Spaces bucket name',
    initialValue: current?.bucket_name ?? `${name}-images-${crypto.randomUUID().slice(0, 8)}`,
    help: 'Choose a globally unique name. Terraform will create the bucket later; do not create it manually.',
    valid: value => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value),
    error: 'Use 3–63 lowercase letters, digits, or hyphens, beginning and ending with a letter or digit.',
  });

  const next: TerraformValues = {
    ...previous,
    existing_droplet_id: dropletId,
    existing_database_id: databaseId,
    configuration: {
      ...current,
      name,
      region: droplet.region.slug,
      application_database: applicationDatabase,
      droplet: {
        ...current?.droplet,
        name: dropletName,
        size: dropletSize,
        image: current?.droplet.image ?? 'debian-13-x64',
        vpc_uuid: droplet.vpc_uuid,
        ssh_keys: current?.droplet.ssh_keys ?? [],
      },
      database: {
        ...current?.database,
        name: databaseName,
        version,
        size: databaseSize,
        node_count: nodeCount,
        vpc_uuid: droplet.vpc_uuid,
      },
      admin_ipv4_cidrs: split(admin),
      database_client_ipv4s: split(clientInput),
      bucket_name: bucket,
      enable_storage_ip_restriction: current?.enable_storage_ip_restriction ?? false,
      api_hostname: current?.api_hostname ?? '',
    },
  };

  const beforeDroplet = dropletChoices.find(item => item.value === (current?.droplet.size ?? droplet.size.slug))?.label;
  const afterDroplet = dropletChoices.find(item => item.value === dropletSize)?.label;
  const beforeDatabase = databaseChoices.find(item => item.value === (current?.database.size ?? database.size))?.label;
  const afterDatabase = databaseChoices.find(item => item.value === databaseSize)?.label;
  prompts.note(
    `Droplet capacity:\n  Before: ${beforeDroplet}\n  After:  ${afterDroplet}\nDatabase capacity:\n  Before: ${beforeDatabase}; ${savedCount} node(s)\n  After:  ${afterDatabase}; ${nodeCount} node(s)\nPostgreSQL: ${current?.database.version ?? database.version} → ${version}\nApplication database: ${current?.application_database ?? 'not configured'} → ${applicationDatabase}\nAdministrator access: ${admin}\nDatabase clients: ${clientInput || 'none'}\nBucket: ${bucket}\nNo infrastructure changes happen now. A later Terraform apply may interrupt service and permanently increase disk capacity.`,
    'Review resource settings',
  );

  if (await prompts.confirm('Save these resource settings?', true)) {
    const changed = await store.saveTerraform(document, next);

    const savedMessage = document.contents
      ? 'Resource settings saved. The previous file was backed up privately; HCL comments may be regenerated.'
      : 'Resource settings saved. Terraform will use this file when you generate a plan.';

    prompts.note(changed ? savedMessage : 'Resource settings are unchanged; the original file was not rewritten.');
  }
}

async function setupRelease({ store, prompts }: WizardOptions, infrastructure: EnvironmentDocument): Promise<void> {
  prompts.note(
    'Release connection settings can be completed after infra-configure registers the Droplet in Tailscale.',
    '8/8 · Release access',
  );
  const document = await store.readEnvironment('release');

  if (
    !(await prompts.confirm('Is the Droplet already connected to Tailscale?', Boolean(document.values.TCG_DEPLOY_HOST)))
  ) {
    return;
  }

  const hostname = await text({
    prompts,
    message: 'Droplet Tailscale hostname or address',
    initialValue: document.values.TCG_DEPLOY_HOST,
    help: 'Open Tailscale → Machines → your Linux server → Full domain. Copy the full hostname without https://.',
    valid: host,
  });

  const key = await text({
    prompts,
    message: 'Deployment private key path',
    initialValue: document.values.TCG_DEPLOY_KEY ?? store.paths.deploymentKey,
  });

  const keyPath = homePath(key);

  if (!(await fileExists(keyPath))) {
    failure('The deployment key file does not exist. Complete the SSH key step and rerun setup.');
  }

  const existingHosts = document.values.TCG_KNOWN_HOSTS
    ? homePath(document.values.TCG_KNOWN_HOSTS)
    : store.paths.knownHosts;

  let hostsPath = existingHosts;
  let verifiedHostKey: string | undefined;

  const existingMatches =
    (await fileExists(existingHosts)) &&
    (await fs.readFile(existingHosts, 'utf8'))
      .split(/\r?\n/)
      .some(line => line.split(/\s+/)[0]?.split(',').includes(hostname));

  if (!existingMatches || !(await prompts.confirm('Keep the existing verified known-hosts file?', true))) {
    const keyValue = await text({
      prompts,
      message: 'Droplet host public key',
      help: 'In the trusted DIGITALOCEAN DROPLET CONSOLE run:\ncat /etc/ssh/ssh_host_ed25519_key.pub\nPaste its ssh-ed25519 public key here. This is the SERVER HOST KEY, not your deployment public key.',
      valid: value => Boolean(publicKey(value)),
    });

    if (!(await prompts.confirm('Was this host key copied from the trusted Droplet console?', false))) {
      failure('Host key was not verified. Release connection settings were not saved.');
    }

    verifiedHostKey = publicKey(keyValue);
    hostsPath = store.paths.knownHosts;
  }

  const image = await text({
    prompts,
    message: 'Release image repository',
    initialValue: document.values.TCG_IMAGE_REPOSITORY ?? infrastructure.values.TCG_IMAGE_REPOSITORY,
    valid: value => {
      return ReleaseRepositorySchema.safeParse(value).success && value === infrastructure.values.TCG_IMAGE_REPOSITORY;
    },
    error: 'Use the same image repository as the infrastructure settings.',
  });

  if (verifiedHostKey) {
    await store.saveKnownHosts(hostname, verifiedHostKey);
  }

  await store.saveEnvironment(document, {
    TCG_DEPLOY_HOST: hostname,
    TCG_DEPLOY_KEY: keyPath,
    TCG_KNOWN_HOSTS: hostsPath,
    TCG_IMAGE_REPOSITORY: image,
  });
  const publishing = credentials.find(item => item.id === 'publishing');

  if (publishing) {
    await askCredential({ credential: publishing, prompts, document });
    prompts.note(credentialNext(publishing, store));
  }
}

export async function runSetup(options: WizardOptions): Promise<void> {
  const { store, prompts, repositoryRoot } = options;
  prompts.note(
    'This wizard saves local settings only. It does not apply infrastructure or release the server. Existing answers are defaults.',
    'Prepare the release flow',
  );
  let document = await store.readEnvironment('infrastructure');
  prompts.note('Create or reuse your HCP workspace and user token.', '1/8 · HCP Terraform');

  const organization = await text({
    prompts,
    message: 'HCP organization identifier',
    initialValue: document.values.TF_CLOUD_ORGANIZATION,
    help: 'Create an HCP Terraform organization and CLI-driven workspace. Set execution mode to Local; disable VCS auto-apply. Remote state sharing: specific workspaces, with an empty list. The organization identifier appears in its URL.',
  });

  const workspace = await text({
    prompts,
    message: 'HCP workspace name',
    initialValue: document.values.TF_WORKSPACE ?? 'tcg-production',
  });

  const hcp = credentials.find(item => item.id === 'hcp');

  if (!hcp) {
    return failure('HCP credential instructions are unavailable.');
  }

  document = await saveFields(store, document, {
    TF_CLOUD_ORGANIZATION: organization,
    TF_WORKSPACE: workspace,
    ...(await askCredential({ credential: hcp, prompts, document })),
  });

  for (const id of ['digitalocean', 'spaces']) {
    prompts.note(
      id === 'digitalocean' ? 'Prepare the account API token.' : 'Prepare the bucket administrator key pair.',
      id === 'digitalocean' ? '2/8 · DigitalOcean' : '3/8 · Spaces',
    );
    const credential = credentials.find(item => item.id === id);

    if (!credential) {
      return failure('Credential instructions are unavailable.');
    }

    document = await saveFields(store, document, await askCredential({ credential, prompts, document }));
  }

  prompts.note(
    'Use an existing dedicated deployment key, or run this ONCE in another Mac terminal:\nssh-keygen -t ed25519 -f ' +
      shellQuote(store.paths.deploymentKey) +
      ' -C tcg-release\nLeave the passphrase empty for unattended use, or unlock an encrypted key in an SSH agent before releasing.',
    '4/8 · Deployment SSH key',
  );
  const release = await store.readEnvironment('release');

  const deploymentKey = homePath(
    await text({
      prompts,
      message: 'Deployment private key path',
      initialValue: release.values.TCG_DEPLOY_KEY ?? store.paths.deploymentKey,
    }),
  );

  if (!(await fileExists(deploymentKey))) {
    failure(
      'Deployment key not found. Run the displayed generation command, then rerun setup. Completed sections are saved.',
    );
  }

  let publicDefault = document.values.TCG_DEPLOY_PUBLIC_KEY;

  if (!publicDefault && (await fileExists(`${deploymentKey}.pub`))) {
    publicDefault = (await fs.readFile(`${deploymentKey}.pub`, 'utf8')).trim();
  }

  const deploymentPublicKey = await text({
    prompts,
    message: 'Deployment public key',
    initialValue: publicDefault,
    help: 'Use the complete line from the deployment key’s .pub file, not the server host key.',
    valid: value => Boolean(publicKey(value)),
  });

  document = await saveFields(store, document, { TCG_DEPLOY_PUBLIC_KEY: publicKey(deploymentPublicKey) ?? '' });
  await store.saveEnvironment(release, { TCG_DEPLOY_KEY: deploymentKey });

  const remote = gitRemoteUrl((program, args) => {
    return childProcess.spawnSync(program, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
  });

  const repository = remote.stdout.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  prompts.note(
    'Choose where release images will be published and how the Droplet will download them.',
    '5/8 · Image registry',
  );

  const image = await text({
    prompts,
    message: 'Image repository',
    initialValue:
      document.values.TCG_IMAGE_REPOSITORY ?? (repository ? `ghcr.io/${repository.toLowerCase()}-server` : undefined),
    help: 'Use ghcr.io/owner/repository-server, all lowercase, without https:// or a tag. Images are uploaded during release; you do not need to create one first.',
    valid: value => ReleaseRepositorySchema.safeParse(value).success,
    error: 'Use ghcr.io/lowercase-owner/lowercase-repository-server without https:// or a tag.',
  });

  document = await saveFields(store, document, { TCG_IMAGE_REPOSITORY: image });

  const privateImages = await prompts.confirm(
    'Will the images be private? (GitHub defaults to private)',
    document.values.TCG_REGISTRY_TOKEN !== '',
  );

  if (privateImages) {
    const username = await text({
      prompts,
      message: 'GitHub username for image downloads',
      initialValue: document.values.TCG_REGISTRY_USER ?? repository?.split('/')[0],
    });

    const download = credentials.find(item => item.id === 'download');

    if (!download) {
      return failure('Registry instructions are unavailable.');
    }

    document = await saveFields(store, document, {
      TCG_REGISTRY_USER: username,
      ...(await askCredential({ credential: download, prompts, document })),
    });
  } else {
    document = await saveFields(store, document, { TCG_REGISTRY_USER: '', TCG_REGISTRY_TOKEN: '' });
  }

  prompts.note('Use the existing tailnet; the bootstrap key is only for server registration.', '6/8 · Tailscale');
  const tailscale = credentials.find(item => item.id === 'tailscale');

  if (!tailscale) {
    return failure('Tailscale instructions are unavailable.');
  }

  document = await saveFields(store, document, await askCredential({ credential: tailscale, prompts, document }));
  const scrydex = credentials.find(item => item.id === 'scrydex');

  if (!scrydex) {
    return failure('Scrydex credential instructions are unavailable.');
  }

  prompts.note(
    'Production requires live Scrydex pricing and card images. Static mode is limited to development and tests.',
  );
  document = await saveFields(store, document, await askCredential({ credential: scrydex, prompts, document }));

  const resourcesReady = await setupResources(options, document);
  await setupRelease(options, document);

  if (!resourcesReady) {
    prompts.note(
      `Completed sections are saved. Rerun just setup-infra --config-dir ${shellQuote(store.paths.configDirectory)} to finish resource settings before running infrastructure commands.`,
    );

    return;
  }

  prompts.note(
    `Settings saved. Infrastructure has not changed.\nBefore host configuration, verify administrative SSH access with the server fingerprint from the DigitalOcean console.\nRun each command separately, reviewing the plan BEFORE apply:\n${['infra-init', 'infra-plan', 'infra-apply', 'infra-configure'].map(action => `just --dotenv-path ${shellQuote(store.paths.infrastructure)} ${action}`).join('\n')}\nRerun just setup-infra --config-dir ${shellQuote(store.paths.configDirectory)} to complete deferred release access.`,
    'Next steps',
  );
}

export async function runRotation({ store, prompts }: WizardOptions): Promise<void> {
  const document = await store.readEnvironment('infrastructure');

  const selected = await prompts.multiselect({
    message: 'Which credentials do you want to replace?',
    options: credentials.map(item => ({ value: item.id, label: item.label })),
  });

  const replacements = new Map<string, string>();

  for (const id of selected) {
    const credential = credentials.find(item => item.id === id);

    if (!credential) {
      failure('Unknown credential selection.');
    }

    for (const [key, value] of Object.entries(await askCredential({ credential, prompts, document, replace: true }))) {
      replacements.set(key, value);
    }

    prompts.note(credentialNext(credential, store));
  }

  const changes = Object.fromEntries(replacements);

  if (Object.keys(changes).length && (await prompts.confirm('Save the selected replacement credentials?', false))) {
    await store.saveEnvironment(document, changes);
    prompts.note(
      'Replacement saved. Activate and verify it with the instructions above before revoking the old credential.',
    );
  }
}
