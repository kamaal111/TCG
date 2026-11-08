import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import z from 'zod';

import { failure, InfraFailure } from './errors.ts';

const execute = util.promisify(childProcess.execFile);

const justfile = url.fileURLToPath(new URL('../../justfile', import.meta.url));

const scalar = z.string().refine(value => !/[\r\n\0`]/.test(value));

export function homePath(value: string): string {
  return path.resolve(value.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir()));
}

const ConfigurationSchema = z.looseObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
  region: z.string().nonempty(),
  application_database: z.string().nonempty(),
  droplet: z.looseObject({
    name: z.string().nonempty(),
    size: z.string().nonempty(),
    image: z.string().nonempty(),
    vpc_uuid: z.string().nonempty(),
    ssh_keys: z.array(z.string()),
  }),
  database: z.looseObject({
    name: z.string().nonempty(),
    version: z.string().nonempty(),
    size: z.string().nonempty(),
    node_count: z.number().int().positive(),
    vpc_uuid: z.string().nonempty(),
  }),
  admin_ipv4_cidrs: z.array(z.string()).nonempty(),
  database_client_ipv4s: z.array(z.string()),
  bucket_name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  enable_storage_ip_restriction: z.boolean(),
});

const TerraformSchema = z.looseObject({
  existing_droplet_id: z.string().nonempty(),
  existing_database_id: z.string().nonempty(),
  configuration: ConfigurationSchema,
});

export type TerraformValues = z.infer<typeof TerraformSchema>;

export interface EnvironmentDocument {
  file: string;
  contents: string;
  values: Record<string, string>;
}

export interface TerraformDocument {
  file: string;
  contents: string;
  values: TerraformValues | undefined;
}

interface StoreOptions {
  repositoryRoot: string;
  configDirectory: string;
}

const HclLiteralSchema: z.ZodType<string, unknown> = z.lazy(() => {
  return z.union([
    z.string().transform(value => {
      return JSON.stringify(value)
        .replace(/\$\{/g, () => '$${')
        .replace(/%\{/g, () => '%%{');
    }),
    z.number().transform(value => String(value)),
    z.boolean().transform(value => String(value)),
    z.null().transform(() => 'null'),
    z.array(HclLiteralSchema).transform(values => `[${values.join(', ')}]`),
    z.record(z.string(), HclLiteralSchema).transform(values => {
      return `{\n${Object.entries(values)
        .map(([key, value]) => `  ${JSON.stringify(key)} = ${value.replace(/\n/g, '\n  ')}`)
        .join('\n')}\n}`;
    }),
  ]);
});

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function readSettingsFile(file: string): Promise<string> {
  try {
    const info = await fs.lstat(file);

    if (!info.isFile()) {
      failure('A settings path is not a regular file. Use a private regular file.');
    }

    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

function assignmentKeys(source: string): string[] {
  return source.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);

    return match?.[1] ? [match[1]] : [];
  });
}

function serializeEnvironment(value: string): string {
  if (!scalar.safeParse(value).success) {
    failure('Use a single-line value without NUL or backtick characters.');
  }

  return `"${value.replace(/[\\"$]/g, character => `\\${character}`)}"`;
}

export class ConfigStore {
  readonly paths;

  constructor({ repositoryRoot, configDirectory }: StoreOptions) {
    const directory = path.resolve(configDirectory);
    this.paths = {
      configDirectory: directory,
      infrastructure: path.join(directory, 'infrastructure.env'),
      release: path.join(directory, 'release.env'),
      deploymentKey: path.join(directory, 'deploy-key'),
      knownHosts: path.join(directory, 'deploy-known-hosts'),
      terraformDirectory: path.join(repositoryRoot, 'infra/environments/production'),
    };
  }

  async readEnvironment(kind: 'infrastructure' | 'release'): Promise<EnvironmentDocument> {
    const file = this.paths[kind];
    const source = await readSettingsFile(file);
    const keys = assignmentKeys(source);

    if (new Set(keys).size !== keys.length) {
      failure('Duplicate assignments found in the settings file. Remove duplicates before continuing.');
    }

    if (!source) {
      return { file, contents: source, values: {} };
    }

    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !keys.includes(key)));

    const program =
      'const keys = JSON.parse(process.argv[1]); console.log(JSON.stringify(Object.fromEntries(keys.map(key => [key, process.env[key] ?? ""]))));';

    try {
      const result = await execute(
        'just',
        [
          '--justfile',
          justfile,
          '--dotenv-path',
          file,
          '--command',
          process.execPath,
          '-e',
          program,
          JSON.stringify(keys),
        ],
        { env: environment, timeout: 10_000 },
      );

      const values = z.record(z.string(), z.string()).parse(JSON.parse(result.stdout));

      return { file, contents: source, values };
    } catch {
      return failure(
        'Cannot read the environment file. Check its assignment syntax and quoting; no values were changed.',
      );
    }
  }

  async saveEnvironment(document: EnvironmentDocument, changes: Record<string, string>): Promise<void> {
    const pending = new Map(Object.entries(changes).filter(([key, value]) => document.values[key] !== value));

    if (pending.size === 0) {
      return;
    }

    for (const [key, value] of pending) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        failure('Invalid environment setting name.');
      }

      serializeEnvironment(value);
    }

    const lines = document.contents
      .replace(/\r?\n$/, '')
      .split(/\r?\n/)
      .map(line => {
        const key = assignmentKeys(line)[0];

        if (key === undefined || !pending.has(key)) {
          return line;
        }

        const value = pending.get(key);
        pending.delete(key);

        return `${key}=${serializeEnvironment(value ?? '')}`;
      });

    for (const [key, value] of pending) {
      lines.push(`${key}=${serializeEnvironment(value)}`);
    }

    const next = `${lines.filter((line, index) => line !== '' || index !== 0).join('\n')}\n`;
    await this.write({ file: document.file, previous: document.contents, next });
  }

  async readTerraform(): Promise<TerraformDocument> {
    const base = path.join(this.paths.terraformDirectory, 'terraform.tfvars');
    const nativeExists = await exists(base);
    const jsonExists = await exists(`${base}.json`);
    const native = await readSettingsFile(base);
    const json = await readSettingsFile(`${base}.json`);

    if (nativeExists && jsonExists) {
      failure(
        'Both terraform.tfvars and terraform.tfvars.json exist. Keep only one active settings file before continuing.',
      );
    }

    const file = nativeExists ? base : `${base}.json`;
    const source = native || json;

    if (!nativeExists && !jsonExists) {
      return { file, contents: '', values: undefined };
    }

    let directory: string | undefined;

    try {
      let input: unknown;

      if (jsonExists) {
        input = JSON.parse(json);
      } else {
        await this.prepareDirectory();
        directory = await fs.mkdtemp(path.join(this.paths.configDirectory, '.terraform-read-'));
        await fs.chmod(directory, 0o700);
        await fs.writeFile(
          path.join(directory, 'variables.tf'),
          ['configuration', 'existing_droplet_id', 'existing_database_id']
            .map(name => `variable "${name}" { type = any }`)
            .join('\n'),
          { mode: 0o600 },
        );

        const environment = Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('TF_') && !key.startsWith('TERRAFORM_')),
        );

        const expression =
          'jsonencode({ configuration = var.configuration, existing_droplet_id = var.existing_droplet_id, existing_database_id = var.existing_database_id })\n';

        const result = childProcess.spawnSync(
          process.env.TCG_TERRAFORM_BIN ?? 'terraform',
          [`-chdir=${directory}`, 'console', '-no-color', `-var-file=${file}`],
          { input: expression, env: { ...environment, CHECKPOINT_DISABLE: '1' }, encoding: 'utf8', timeout: 10_000 },
        );

        if (result.status !== 0 || result.stderr.trim()) {
          failure('Cannot safely read the Terraform settings. Keep the original file and check it manually.');
        }

        input = JSON.parse(z.string().parse(JSON.parse(result.stdout)));
      }

      const parsed = TerraformSchema.safeParse(input);

      if (!parsed.success) {
        failure('Terraform settings do not match the supported configuration. The original file was preserved.');
      }

      return { file, contents: source, values: parsed.data };
    } catch (error) {
      if (error instanceof InfraFailure) {
        throw error;
      }

      return failure('Cannot safely read the Terraform settings. The original file was preserved.');
    } finally {
      if (directory) {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  }

  async saveTerraform(document: TerraformDocument, values: TerraformValues): Promise<boolean> {
    const parsed = TerraformSchema.safeParse(values);

    if (!parsed.success) {
      failure('Resource settings are incomplete or invalid. Nothing was saved.');
    }

    if (util.isDeepStrictEqual(document.values, parsed.data)) {
      return false;
    }

    const json = z.json().parse(parsed.data);

    const next = document.file.endsWith('.json')
      ? `${JSON.stringify(json, null, 2)}\n`
      : `${Object.entries(parsed.data)
          .map(([key, value]) => `${key} = ${HclLiteralSchema.parse(value)}`)
          .join('\n')}\n`;

    if (document.contents) {
      if ((await readSettingsFile(document.file)) !== document.contents) {
        failure('Settings changed in another process. Rerun the wizard before saving.');
      }

      await this.prepareDirectory();
      const backups = path.join(this.paths.configDirectory, 'backups');
      await fs.mkdir(backups, { recursive: true, mode: 0o700 });
      await fs.chmod(backups, 0o700);
      await fs.writeFile(
        path.join(
          backups,
          `terraform-${crypto.randomUUID()}${document.file.endsWith('.json') ? '.tfvars.json' : '.tfvars'}`,
        ),
        document.contents,
        { mode: 0o600, flag: 'wx' },
      );
    }

    await this.write({ file: document.file, previous: document.contents, next });

    return true;
  }

  async saveKnownHosts(hostname: string, key: string): Promise<void> {
    const file = this.paths.knownHosts;
    const source = await readSettingsFile(file);
    const lines = source.split(/\r?\n/).filter(line => !line.split(/\s+/)[0]?.split(',').includes(hostname));
    const next = [...lines.filter(Boolean), `${hostname} ${key}`].join('\n') + '\n';
    await this.write({ file, previous: source, next });
  }

  private async prepareDirectory(): Promise<void> {
    await fs.mkdir(this.paths.configDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.paths.configDirectory, 0o700);
  }

  private async write({ file, previous, next }: { file: string; previous: string; next: string }): Promise<void> {
    if (previous === next) {
      return;
    }

    await this.prepareDirectory();
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(file), `.settings-${crypto.randomUUID()}`);

    try {
      await fs.writeFile(temporary, next, { flag: 'wx', mode: 0o600 });

      if ((await readSettingsFile(file)) !== previous) {
        failure('Settings changed in another process. Rerun the wizard before saving.');
      }

      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
