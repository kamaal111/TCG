import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import z from 'zod';

import { ConfigStore, type TerraformValues } from './infra/config.ts';
import { databaseSizeChoices, DigitalOcean, dropletSizeChoices } from './infra/digitalocean.ts';
import { InfraFailure } from './infra/errors.ts';
import type { Prompts } from './infra/prompts.ts';
import { runRotation, runSetup } from './infra/wizard.ts';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg infra wizard-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'infra/environments/production'), { recursive: true });
  const store = new ConfigStore({ repositoryRoot: root, configDirectory: path.join(root, 'private settings') });

  return { root, store };
}

it('rotates only selected credentials and round-trips shell literals through just and Bash', async () => {
  const { store } = await fixture();
  await fs.mkdir(store.paths.configDirectory, { recursive: true });
  const file = store.paths.infrastructure;
  await fs.writeFile(file, '# keep this comment\nDIGITALOCEAN_TOKEN="old-token"\nUNCHANGED="keep-me"\n');
  const document = await store.readEnvironment('infrastructure');
  const replacement = 'fixture $dollar "quote" apostrophe\' and \\slash';
  await store.saveEnvironment(document, { DIGITALOCEAN_TOKEN: replacement });
  const updated = await store.readEnvironment('infrastructure');

  const bash = childProcess.spawnSync('bash', ['-c', 'source "$1"; printf %s "$DIGITALOCEAN_TOKEN"', 'bash', file], {
    encoding: 'utf8',
  });

  expect(updated.values.DIGITALOCEAN_TOKEN).toBe(replacement);
  expect(bash.stdout).toBe(replacement);
  expect(bash.status).toBe(0);
  expect(await fs.readFile(file, 'utf8')).toContain('# keep this comment');
  expect(await fs.readFile(file, 'utf8')).toContain('UNCHANGED="keep-me"');
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
});

it('keeps saved capacity selected separately from the running capacity', () => {
  const choices = dropletSizeChoices({
    sizes: [
      {
        slug: 's-1vcpu-512mb-10gb',
        description: 'Basic',
        vcpus: 1,
        memory: 512,
        disk: 10,
        price_monthly: 4,
        regions: ['ams3'],
        available: true,
      },
      {
        slug: 's-1vcpu-2gb',
        description: 'Basic',
        vcpus: 1,
        memory: 2048,
        disk: 50,
        price_monthly: 12,
        regions: ['ams3'],
        available: true,
      },
    ],
    saved: 's-1vcpu-2gb',
    running: 's-1vcpu-512mb-10gb',
    region: 'ams3',
    disk: 10,
  });

  expect(choices).toContainEqual(
    expect.objectContaining({
      value: 's-1vcpu-2gb',
      label: 'Basic — 1 CPU, 2 GB RAM, 50 GB disk — $12/month',
      hint: 'saved',
    }),
  );
  expect(choices).toContainEqual(expect.objectContaining({ value: 's-1vcpu-512mb-10gb', hint: 'running' }));
});

it('uses readable database options for supported size and node combinations', () => {
  const choices = databaseSizeChoices({
    slugs: ['db-s-1vcpu-1gb', 'db-s-1vcpu-2gb'],
    saved: 'db-s-1vcpu-1gb',
    running: 'db-s-1vcpu-1gb',
  });

  expect(choices[0]).toEqual({ value: 'db-s-1vcpu-1gb', label: 'Regular — 1 CPU, 1 GB RAM', hint: 'saved, running' });
});

const hostPublicKey = `ssh-ed25519 ${Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 1)]).toString('base64')}`;

function resourceValues(size = 's-1vcpu-512mb-10gb'): TerraformValues {
  return {
    existing_droplet_id: '101',
    existing_database_id: 'example-database',
    configuration: {
      name: 'tcg-production',
      region: 'ams3',
      application_database: 'defaultdb',
      droplet: { name: 'tcg-server', size, image: 'debian-13-x64', vpc_uuid: 'example-vpc', ssh_keys: [] },
      database: { name: 'tcg-postgres', size: 'db-s-1vcpu-1gb', version: '18', node_count: 1, vpc_uuid: 'example-vpc' },
      admin_ipv4_cidrs: ['192.0.2.10/32'],
      database_client_ipv4s: ['192.0.2.10'],
      bucket_name: 'tcg-images-example',
      enable_storage_ip_restriction: false,
      api_hostname: '',
      preserved_setting: { literal: 'keep this', enabled: true },
    },
  };
}

const environment = {
  TF_CLOUD_ORGANIZATION: 'example-org',
  TF_WORKSPACE: 'tcg-production',
  TF_TOKEN_app_terraform_io: 'fixture-hcp-secret',
  DIGITALOCEAN_TOKEN: 'fixture-do-secret',
  SPACES_ACCESS_KEY_ID: 'fixture-spaces-id',
  SPACES_SECRET_ACCESS_KEY: 'fixture-spaces-secret',
  TCG_DEPLOY_PUBLIC_KEY: hostPublicKey,
  TCG_IMAGE_REPOSITORY: 'ghcr.io/example/tcg-server',
  TCG_REGISTRY_USER: 'example',
  TCG_REGISTRY_TOKEN: 'fixture-download-secret',
  TCG_TAILSCALE_AUTH_KEY: 'fixture-tailscale-secret',
};

interface Answers {
  text?: Record<string, string[]>;
  select?: Record<string, string>;
  confirm?: Record<string, boolean>;
  selected?: string[];
  passwords?: string[];
  cancelOnPassword?: number;
}

function scripted(answers: Answers = {}) {
  const texts = structuredClone(answers.text ?? {});
  const passwords = [...(answers.passwords ?? [])];
  const notes: string[] = [];
  const questions: { message: string; initialValue?: string | boolean; options?: unknown }[] = [];
  let passwordCount = 0;

  const prompts: Prompts = {
    text: async question => {
      questions.push(question);

      return texts[question.message]?.shift() ?? question.initialValue ?? '';
    },
    password: async message => {
      passwordCount++;
      questions.push({ message });

      if (passwordCount === answers.cancelOnPassword || passwords.length === 0) {
        throw new InfraFailure('Cancelled.', 130);
      }

      return passwords.shift() ?? '';
    },
    select: async question => {
      questions.push(question);
      const saved = question.options.find(option => option.value === question.initialValue);
      const value = answers.select?.[question.message] ?? saved?.value ?? question.options[0]?.value ?? '';
      expect(question.options.map(option => option.value)).toContain(value);

      return value;
    },
    multiselect: async question => {
      questions.push(question);

      return answers.selected ?? [];
    },
    confirm: async (message, initialValue = true) => {
      questions.push({ message, initialValue });

      return answers.confirm?.[message] ?? initialValue;
    },
    note: (message, title) => notes.push(`${title ?? ''}\n${message}`),
  };

  return { prompts, notes, questions };
}

type ProviderBody = z.infer<ReturnType<typeof z.json>>;

function inputUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  return new URL(input);
}

function providerFixture(overrides: Record<string, ProviderBody> = {}) {
  const size = {
    slug: 's-1vcpu-512mb-10gb',
    description: 'Basic',
    vcpus: 1,
    memory: 512,
    disk: 10,
    price_monthly: 4,
    regions: ['ams3'],
    available: true,
  };

  const responses = new Map<string, ProviderBody>(
    Object.entries({
      '/v2/droplets': {
        droplets: [{ id: 101, name: 'tcg-server', region: { slug: 'ams3' }, size, disk: 10, vpc_uuid: 'example-vpc' }],
      },
      '/v2/databases': {
        databases: [
          {
            id: 'example-database',
            name: 'tcg-postgres',
            engine: 'pg',
            region: 'ams3',
            size: 'db-s-1vcpu-1gb',
            version: '18',
            num_nodes: 1,
            private_network_uuid: 'example-vpc',
            password: 'provider-secret-must-not-leak',
          },
        ],
      },
      '/v2/vpcs': { vpcs: [{ id: 'example-vpc', name: 'Amsterdam private network', region: 'ams3' }] },
      '/v2/regions': { regions: [{ slug: 'ams3', name: 'Amsterdam 3', available: true }] },
      '/v2/sizes': {
        sizes: [
          size,
          { ...size, slug: 's-1vcpu-1gb', memory: 1024, disk: 25, price_monthly: 6 },
          { ...size, slug: 's-1vcpu-2gb', memory: 2048, disk: 50, price_monthly: 12 },
        ],
      },
      '/v2/databases/options': {
        options: {
          pg: {
            regions: ['ams3'],
            versions: ['17', '18'],
            layouts: [
              { num_nodes: 1, sizes: ['db-s-1vcpu-1gb', 'db-s-1vcpu-2gb'] },
              { num_nodes: 2, sizes: ['db-s-1vcpu-2gb'] },
            ],
          },
        },
      },
      '/v2/databases/example-database/firewall': {
        rules: [
          { type: 'droplet', value: '101' },
          { type: 'ip_addr', value: '192.0.2.10' },
        ],
      },
      '/v2/databases/example-database/dbs': { dbs: [{ name: 'defaultdb' }, { name: 'analytics' }] },
      ...overrides,
    }).map(([key, value]): [string, ProviderBody] => [key, z.json().parse(value)]),
  );

  const requests: { url: string; method: string | undefined }[] = [];

  const request: typeof fetch = async (input, init) => {
    const address = inputUrl(input);
    requests.push({ url: address.pathname, method: init?.method });

    return new Response(JSON.stringify(responses.get(address.pathname) ?? {}), { status: 200 });
  };

  return { request, requests };
}

async function configured(size?: string) {
  const result = await fixture();
  const { store } = result;
  await store.saveEnvironment(await store.readEnvironment('infrastructure'), environment);
  await fs.writeFile(store.paths.deploymentKey, 'fixture-private-key', { mode: 0o600 });
  await fs.writeFile(`${store.paths.deploymentKey}.pub`, hostPublicKey);
  await store.saveEnvironment(await store.readEnvironment('release'), { TCG_DEPLOY_KEY: store.paths.deploymentKey });
  const file = path.join(store.paths.terraformDirectory, 'terraform.tfvars.json');
  const values = resourceValues(size);
  const original = JSON.stringify(values, null, 4) + '\n';
  await fs.writeFile(file, original, { mode: 0o600 });

  return { ...result, file, original, values };
}

it('retains existing defaults without rewriting the Terraform file or exposing secrets', async () => {
  const f = await configured('s-1vcpu-2gb');
  const ui = scripted();
  const api = providerFixture();
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request: api.request });

  expect(ui.questions).toContainEqual(
    expect.objectContaining({ message: 'Droplet size', initialValue: 's-1vcpu-2gb' }),
  );
  expect(ui.questions).toContainEqual(
    expect.objectContaining({ message: 'HCP organization identifier', initialValue: 'example-org' }),
  );
  expect(await fs.readFile(f.file, 'utf8')).toBe(f.original);
  expect(ui.notes.join('\n')).toContain('original file was not rewritten');
  expect(ui.notes.join('\n')).not.toContain('fixture-do-secret');
  expect(ui.notes.join('\n')).not.toContain('provider-secret-must-not-leak');
  expect(api.requests.every(request => request.method === 'GET')).toBe(true);
});

it('prepares a capacity change using readable choices while preserving unrelated configuration', async () => {
  const f = await configured();
  const ui = scripted({ select: { 'Droplet size': 's-1vcpu-1gb' } });
  const api = providerFixture();
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request: api.request });
  const saved = await f.store.readTerraform();

  expect(saved.values?.configuration.droplet.size).toBe('s-1vcpu-1gb');
  expect(saved.values?.configuration.preserved_setting).toEqual({ literal: 'keep this', enabled: true });
  expect(ui.notes.join('\n')).toContain('After:  Basic — 1 CPU, 1 GB RAM, 25 GB disk');
  expect(ui.notes.join('\n')).toContain('No infrastructure changes happen now');
  expect(await fs.readdir(path.join(f.store.paths.configDirectory, 'backups'))).toHaveLength(1);
});

it('creates fresh settings from guided answers and provider data and defers release access', async () => {
  const f = await fixture();
  await fs.mkdir(f.store.paths.configDirectory, { recursive: true });
  await fs.writeFile(f.store.paths.deploymentKey, 'fixture-private-key', { mode: 0o600 });
  await fs.writeFile(`${f.store.paths.deploymentKey}.pub`, hostPublicKey);

  const ui = scripted({
    text: {
      'HCP organization identifier': ['example-org'],
      'Image repository': ['ghcr.io/example/tcg-server'],
      'GitHub username for image downloads': ['example'],
      'Administrator IPv4 CIDRs (comma separated)': ['192.0.2.10/32/extra', '192.0.2.10/32'],
      'Spaces bucket name': ['tcg-images-example'],
    },
    passwords: ['fresh-hcp', 'fresh-do', 'fresh-spaces-id', 'fresh-spaces-secret', 'fresh-download', 'fresh-tailscale'],
  });

  const api = providerFixture();
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request: api.request });
  const resource = await f.store.readTerraform();
  const release = await f.store.readEnvironment('release');

  expect(resource.values?.configuration.droplet.size).toBe('s-1vcpu-512mb-10gb');
  expect(resource.values?.configuration.database.version).toBe('18');
  expect(resource.values?.configuration.database.vpc_uuid).toBe('example-vpc');
  expect(resource.values?.configuration.admin_ipv4_cidrs).toEqual(['192.0.2.10/32']);
  expect(resource.values?.configuration.database_client_ipv4s).toEqual(['192.0.2.10']);
  expect(resource.values?.configuration.api_hostname).toBe('');
  expect(release.values.TCG_DEPLOY_HOST).toBeUndefined();
  expect(ui.notes.join('\n')).toContain('Tag: Read, Delete');
  expect(ui.notes.join('\n')).toContain('Enter IPv4 CIDRs');
  expect(ui.notes.join('\n')).not.toContain('fresh-spaces-secret');
  expect((await fs.stat(f.store.paths.configDirectory)).mode & 0o777).toBe(0o700);
});

it('rotates only the selected DigitalOcean token with the shared creation and activation instructions', async () => {
  const f = await configured();

  const ui = scripted({
    selected: ['digitalocean'],
    passwords: ['replacement-do'],
    confirm: { 'Save the selected replacement credentials?': true },
  });

  await runRotation({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });
  const updated = await f.store.readEnvironment('infrastructure');

  expect(updated.values).toEqual({ ...environment, DIGITALOCEAN_TOKEN: 'replacement-do' });
  expect(ui.notes.join('\n')).toContain('Tag: Read, Delete');
  expect(ui.notes.join('\n')).toContain('infra-plan');
  expect(ui.notes.join('\n')).toContain('Replacement saved');
  expect(ui.notes.join('\n')).not.toContain('replacement-do');
  expect(await fs.readFile(f.file, 'utf8')).toBe(f.original);
});

it('cancels multi-key rotation without saving a token or half of a Spaces pair', async () => {
  const f = await configured();
  const before = await fs.readFile(f.store.paths.infrastructure, 'utf8');

  const ui = scripted({
    selected: ['digitalocean', 'spaces'],
    passwords: ['replacement-do', 'replacement-spaces-id'],
    cancelOnPassword: 3,
  });

  await expect(runRotation({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root })).rejects.toMatchObject({
    exitCode: 130,
  });
  expect(await fs.readFile(f.store.paths.infrastructure, 'utf8')).toBe(before);
});

it('shows publishing-token login guidance without collecting or writing credentials', async () => {
  const f = await configured();
  const before = await fs.readFile(f.store.paths.infrastructure, 'utf8');
  const ui = scripted({ selected: ['publishing'] });
  await runRotation({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });

  expect(ui.notes.join('\n')).toContain('not your GitHub account password');
  expect(ui.notes.join('\n')).toContain('docker login ghcr.io');
  expect(await fs.readFile(f.store.paths.infrastructure, 'utf8')).toBe(before);
  expect(ui.questions.map(question => question.message)).toEqual(['Which credentials do you want to replace?']);
});

it('saves neither file changes nor activation claims when rotation confirmation is declined', async () => {
  const f = await configured();
  const before = await fs.readFile(f.store.paths.infrastructure, 'utf8');
  const ui = scripted({ selected: ['download'], passwords: ['replacement-download'] });
  await runRotation({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });

  expect(await fs.readFile(f.store.paths.infrastructure, 'utf8')).toBe(before);
  expect(ui.notes.join('\n')).toContain('infra-configure');
  expect(ui.notes.join('\n')).not.toContain('Replacement saved');
});

it('rejects competing Terraform files even when one is empty', async () => {
  const f = await configured();
  await fs.writeFile(path.join(f.store.paths.terraformDirectory, 'terraform.tfvars'), '');

  await expect(f.store.readTerraform()).rejects.toMatchObject({
    message: expect.stringContaining('Both terraform.tfvars'),
  });
  expect(await fs.readFile(f.file, 'utf8')).toBe(f.original);
});

it('rejects concurrent environment edits and removes its private staging file', async () => {
  const f = await configured();
  const document = await f.store.readEnvironment('infrastructure');
  await fs.appendFile(document.file, '# changed elsewhere\n');

  await expect(f.store.saveEnvironment(document, { DIGITALOCEAN_TOKEN: 'replacement' })).rejects.toMatchObject({
    message: expect.stringContaining('another process'),
  });
  expect(await fs.readFile(document.file, 'utf8')).toContain('# changed elsewhere');
  expect((await fs.readdir(f.store.paths.configDirectory)).filter(name => name.startsWith('.settings-'))).toEqual([]);
});

it('rejects duplicate environment assignments without printing their values', async () => {
  const f = await configured();
  await fs.appendFile(f.store.paths.infrastructure, 'DIGITALOCEAN_TOKEN="duplicate-private-value"\n');

  await expect(f.store.readEnvironment('infrastructure')).rejects.toMatchObject({
    message: 'Duplicate assignments found in the settings file. Remove duplicates before continuing.',
  });
});

it('filters unavailable and smaller-disk Droplet choices but retains saved and running plans', () => {
  const base = {
    slug: 'current',
    description: 'Basic',
    vcpus: 1,
    memory: 512,
    disk: 10,
    price_monthly: 4,
    regions: ['ams3'],
    available: true,
  };

  const choices = dropletSizeChoices({
    sizes: [
      base,
      { ...base, slug: 'other-region', regions: ['nyc1'] },
      { ...base, slug: 'too-small', disk: 5 },
      { ...base, slug: 'unavailable', available: false },
    ],
    saved: 'retired-plan',
    running: 'current',
    region: 'ams3',
    disk: 10,
  });

  expect(choices.map(choice => choice.value)).toEqual(['current', 'retired-plan']);
  expect(choices[1]).toEqual({ value: 'retired-plan', label: 'Saved plan — details unavailable', hint: 'saved' });
});

it('refuses to omit unsupported database trusted-source rules', async () => {
  const api = providerFixture({
    '/v2/databases/example-database/firewall': { rules: [{ type: 'tag', value: 'existing-access-tag' }] },
  });

  const provider = new DigitalOcean({ token: 'fixture-token', request: api.request });

  await expect(provider.trustedClients({ database: 'example-database', droplet: 101 })).rejects.toMatchObject({
    message: expect.stringContaining('cannot preserve'),
  });
  expect(api.requests).toEqual([{ url: '/v2/databases/example-database/firewall', method: 'GET' }]);
});

it('reports permission errors without leaking a provider response or token', async () => {
  const request: typeof fetch = async () => new Response('provider-private-diagnostic', { status: 403 });
  const provider = new DigitalOcean({ token: 'fixture-private-token', request });

  await expect(provider.sizes()).rejects.toMatchObject({
    message: 'DigitalOcean lookup failed (403). Check token permissions, then retry or keep saved settings.',
  });
});

it('reports network failures with a safe retry message', async () => {
  const request: typeof fetch = async () => Promise.reject(new InfraFailure('network-private-value'));
  const provider = new DigitalOcean({ token: 'fixture-private-token', request });

  await expect(provider.sizes()).rejects.toMatchObject({
    message: 'DigitalOcean could not be reached. Retry or keep saved settings.',
  });
});

it('supports help without a terminal and rejects interactive non-TTY invocation without creating files', async () => {
  const f = await fixture();

  const help = childProcess.spawnSync(
    process.execPath,
    ['scripts/infra-cli.ts', 'setup', '--help', '--config-dir', f.store.paths.configDirectory],
    { encoding: 'utf8' },
  );

  const nonTty = childProcess.spawnSync(
    process.execPath,
    ['scripts/infra-cli.ts', 'rotate-keys', '--config-dir', f.store.paths.configDirectory],
    { encoding: 'utf8' },
  );

  expect(help.status).toBe(0);
  expect(help.stdout).toContain('just setup-infra');
  expect(nonTty.status).toBe(64);
  expect(nonTty.stderr).toContain('interactive terminal');
  await expect(fs.stat(f.store.paths.configDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reads and updates native HCL without a backend, preserving unknown settings and template literals', async () => {
  const f = await fixture();
  const file = path.join(f.store.paths.terraformDirectory, 'terraform.tfvars');

  const source = [
    '# original comments survive a no-op',
    'existing_droplet_id = "101"',
    'existing_database_id = "example-database"',
    'configuration = {',
    ' name = "tcg-production"',
    ' region = "ams3"',
    ' application_database = "defaultdb"',
    ' droplet = { name = "tcg-server", size = "s-1vcpu-512mb-10gb", image = "debian-13-x64", vpc_uuid = "example-vpc", ssh_keys = [] }',
    ' database = { name = "tcg-postgres", version = "18", size = "db-s-1vcpu-1gb", node_count = 1, vpc_uuid = "example-vpc" }',
    ' admin_ipv4_cidrs = ["192.0.2.10/32"]',
    ' database_client_ipv4s = ["192.0.2.10"]',
    ' bucket_name = "tcg-images-example"',
    ' enable_storage_ip_restriction = false',
    ' api_hostname = "api.example.com"',
    ' note = "literal $${preserved} %%{template}"',
    '}',
    '',
  ].join('\n');

  await fs.writeFile(file, source, { mode: 0o600 });
  const document = await f.store.readTerraform();
  const values = document.values ?? resourceValues();
  const noChange = await f.store.saveTerraform(document, values);
  const unchanged = await fs.readFile(file, 'utf8');

  const changed = await f.store.saveTerraform(document, {
    ...values,
    configuration: { ...values.configuration, droplet: { ...values.configuration.droplet, size: 's-1vcpu-1gb' } },
  });

  const updated = await f.store.readTerraform();

  expect(noChange).toBe(false);
  expect(unchanged).toBe(source);
  expect(changed).toBe(true);
  expect(updated.values?.configuration.droplet.size).toBe('s-1vcpu-1gb');
  expect(updated.values?.configuration.api_hostname).toBe('api.example.com');
  expect(updated.values?.configuration.note).toBe('literal ${preserved} %{template}');
  expect(await fs.readdir(f.store.paths.configDirectory)).toEqual(['backups']);
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
});

it('preserves unsupported native HCL rather than dropping an unknown root setting', async () => {
  const f = await fixture();
  const file = path.join(f.store.paths.terraformDirectory, 'terraform.tfvars');

  const source =
    'existing_droplet_id = "101"\nexisting_database_id = "example-database"\nconfiguration = {}\nextra = "must survive"\n';

  await fs.writeFile(file, source);

  await expect(f.store.readTerraform()).rejects.toMatchObject({
    message: expect.stringContaining('Cannot safely read'),
  });
  expect(await fs.readFile(file, 'utf8')).toBe(source);
});

it('does not rewrite an unchanged environment file', async () => {
  const f = await configured();
  const document = await f.store.readEnvironment('infrastructure');
  await f.store.saveEnvironment(document, { DIGITALOCEAN_TOKEN: document.values.DIGITALOCEAN_TOKEN ?? '' });

  expect(await fs.readFile(document.file, 'utf8')).toBe(document.contents);
});

it('saves a Spaces pair together while preserving every other setting', async () => {
  const f = await configured();

  const ui = scripted({
    selected: ['spaces'],
    passwords: ['new-spaces-access', 'new-spaces-secret'],
    confirm: { 'Save the selected replacement credentials?': true },
  });

  await runRotation({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });
  const document = await f.store.readEnvironment('infrastructure');

  expect(document.values).toEqual({
    ...environment,
    SPACES_ACCESS_KEY_ID: 'new-spaces-access',
    SPACES_SECRET_ACCESS_KEY: 'new-spaces-secret',
  });
  expect((await fs.stat(document.file)).mode & 0o777).toBe(0o600);
  expect(ui.notes.join('\n')).not.toContain('new-spaces-secret');
});

it('retains completed setup sections when the next credential prompt is cancelled', async () => {
  const f = await fixture();

  const ui = scripted({
    text: { 'HCP organization identifier': ['example-org'] },
    passwords: ['new-hcp-token'],
    cancelOnPassword: 2,
  });

  await expect(runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root })).rejects.toMatchObject({
    exitCode: 130,
  });
  expect((await f.store.readEnvironment('infrastructure')).values).toEqual({
    TF_CLOUD_ORGANIZATION: 'example-org',
    TF_WORKSPACE: 'tcg-production',
    TF_TOKEN_app_terraform_io: 'new-hcp-token',
  });
});

it('rejects an image URL with a scheme and asks again before saving', async () => {
  const f = await configured();

  const ui = scripted({
    text: { 'Image repository': ['https://ghcr.io/example/tcg-server', 'ghcr.io/example/tcg-server'] },
    confirm: { 'Review resource settings and capacity?': false },
  });

  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });

  expect(ui.questions.filter(question => question.message === 'Image repository')).toHaveLength(2);
  expect(ui.notes.join('\n')).toContain('without https:// or a tag');
  expect((await f.store.readEnvironment('infrastructure')).values.TCG_IMAGE_REPOSITORY).toBe(
    'ghcr.io/example/tcg-server',
  );
});

it('keeps resource settings after a failed lookup and does not expose provider diagnostics', async () => {
  const f = await configured();
  const ui = scripted();
  const request: typeof fetch = async () => new Response('private-provider-message', { status: 403 });
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request });

  expect(await fs.readFile(f.file, 'utf8')).toBe(f.original);
  expect(ui.notes.join('\n')).toContain('lookup failed (403)');
  expect(ui.notes.join('\n')).not.toContain('private-provider-message');
});

it('follows provider pagination without following arbitrary response URLs', async () => {
  const calls: string[] = [];

  const request: typeof fetch = async input => {
    const address = inputUrl(input);
    calls.push(address.toString());
    const page = address.searchParams.get('page');

    const pages = new Map([
      ['1', { dbs: [{ name: 'defaultdb' }], links: { pages: { next: 'https://untrusted.invalid/do-not-follow' } } }],
      ['2', { dbs: [{ name: 'analytics' }] }],
    ]);

    return new Response(JSON.stringify(pages.get(page ?? '1')));
  };

  const provider = new DigitalOcean({ token: 'fixture-token', request });
  const databases = await provider.logicalDatabases('example-database');

  expect(databases).toEqual([
    { value: 'defaultdb', label: 'defaultdb' },
    { value: 'analytics', label: 'analytics' },
  ]);
  expect(calls).toEqual([
    'https://api.digitalocean.com/v2/databases/example-database/dbs?per_page=200&page=1',
    'https://api.digitalocean.com/v2/databases/example-database/dbs?per_page=200&page=2',
  ]);
});

it('does not offer standby nodes that are unsupported by the selected database size', async () => {
  const f = await configured();
  const ui = scripted();
  const api = providerFixture();
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request: api.request });

  expect(ui.questions).toContainEqual(
    expect.objectContaining({
      message: 'Database nodes',
      options: [{ value: '1', label: 'One primary node, no standby nodes' }],
      initialValue: '1',
    }),
  );
});

it('keeps a mismatched-VPC installation unchanged', async () => {
  const f = await configured();

  const api = providerFixture({
    '/v2/databases': {
      databases: [
        {
          id: 'example-database',
          name: 'tcg-postgres',
          engine: 'pg',
          region: 'ams3',
          size: 'db-s-1vcpu-1gb',
          version: '18',
          num_nodes: 1,
          private_network_uuid: 'different-vpc',
        },
      ],
    },
  });

  const ui = scripted();
  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root, request: api.request });

  expect(await fs.readFile(f.file, 'utf8')).toBe(f.original);
  expect(ui.notes.join('\n')).toContain('same region and VPC');
});

it('collects a verified server key for the exact new hostname and preserves other host entries', async () => {
  const f = await configured();
  await fs.writeFile(f.store.paths.knownHosts, `old.example.ts.net ${hostPublicKey}\n`);

  const ui = scripted({
    confirm: {
      'Review resource settings and capacity?': false,
      'Is the Droplet already connected to Tailscale?': true,
      'Was this host key copied from the trusted Droplet console?': true,
    },
    text: {
      'Droplet Tailscale hostname or address': ['new.example.ts.net'],
      'Droplet host public key': [hostPublicKey],
    },
  });

  await runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root });
  const release = await f.store.readEnvironment('release');

  expect(release.values.TCG_DEPLOY_HOST).toBe('new.example.ts.net');
  expect(await fs.readFile(f.store.paths.knownHosts, 'utf8')).toBe(
    `old.example.ts.net ${hostPublicKey}\nnew.example.ts.net ${hostPublicKey}\n`,
  );
  expect(ui.notes.join('\n')).toContain('Password: prompt');
});

it('does not change release files when the user does not confirm the host key source', async () => {
  const f = await configured();
  const before = await fs.readFile(f.store.paths.release, 'utf8');

  const ui = scripted({
    confirm: {
      'Review resource settings and capacity?': false,
      'Is the Droplet already connected to Tailscale?': true,
    },
    text: {
      'Droplet Tailscale hostname or address': ['new.example.ts.net'],
      'Droplet host public key': [hostPublicKey],
    },
  });

  await expect(runSetup({ store: f.store, prompts: ui.prompts, repositoryRoot: f.root })).rejects.toMatchObject({
    message: expect.stringContaining('not verified'),
  });
  expect(await fs.readFile(f.store.paths.release, 'utf8')).toBe(before);
  await expect(fs.stat(f.store.paths.knownHosts)).rejects.toMatchObject({ code: 'ENOENT' });
});
