import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readAppAuthentication, readAppSettings, saveAppSettings } from './config.ts';
import { setupAppRelease } from './setup.ts';
import type { Prompts } from '../infra/prompts.ts';
import { worktreeFixture } from '../worktree-test-fixture.ts';

const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-setup-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'private settings');
  await fs.mkdir(directory, { recursive: true });
  const authentication = { email: 'release@example.invalid', password: 'test-test-test-test' };
  await fs.writeFile(path.join(directory, 'app-store-connect.json'), JSON.stringify(authentication), { mode: 0o600 });
  await fs.mkdir(path.join(root, 'app/Configuration'), { recursive: true });
  await fs.writeFile(path.join(root, 'app/Configuration/App.xcconfig'), `DEVELOPMENT_TEAM = ${settings.teamID}\n`);
  const text = vi.fn<Prompts['text']>().mockResolvedValue(settings.apiHost);
  const password = vi.fn<Prompts['password']>().mockResolvedValue(authentication.password);
  const confirm = vi.fn<Prompts['confirm']>().mockResolvedValue(true);
  const note = vi.fn<Prompts['note']>();

  const prompts: Prompts = {
    text,
    confirm,
    note,
    password,
    select: vi.fn<Prompts['select']>(),
    multiselect: vi.fn<Prompts['multiselect']>(),
  };

  return { root, directory, text, password, confirm, note, prompts, authentication };
}

async function infrastructure(root: string, apiHost: string, format: 'json' | 'native' = 'json') {
  const values = {
    existing_droplet_id: '101',
    existing_database_id: 'example-database',
    configuration: {
      name: 'tcg-production',
      region: 'ams3',
      application_database: 'defaultdb',
      droplet: {
        name: 'tcg-server',
        size: 's-1vcpu-512mb-10gb',
        image: 'debian-13-x64',
        vpc_uuid: 'example-vpc',
        ssh_keys: [],
      },
      database: { name: 'tcg-postgres', size: 'db-s-1vcpu-1gb', version: '18', node_count: 1, vpc_uuid: 'example-vpc' },
      admin_ipv4_cidrs: ['192.0.2.10/32'],
      database_client_ipv4s: ['192.0.2.10'],
      bucket_name: 'tcg-images-example',
      enable_storage_ip_restriction: false,
      api_hostname: apiHost,
    },
  };

  const parent = path.join(root, 'infra/environments/production');
  await fs.mkdir(parent, { recursive: true });
  const file = path.join(parent, format === 'json' ? 'terraform.tfvars.json' : 'terraform.tfvars');

  const contents =
    format === 'json'
      ? JSON.stringify(values)
      : `existing_droplet_id = "101"\nexisting_database_id = "example-database"\nconfiguration = ${JSON.stringify(values.configuration)}\n`;

  await fs.writeFile(file, contents, { mode: 0o600 });

  return { file, contents };
}

test.each(['json', 'native'] as const)(
  'reuses the %s infrastructure hostname and project team without text questions or infrastructure changes',
  async format => {
    const f = await fixture();
    const infra = await infrastructure(f.root, settings.apiHost, format);
    await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
    expect(f.text).not.toHaveBeenCalled();
    expect(await readAppSettings(f.directory)).toEqual(settings);
    expect(await fs.readFile(infra.file, 'utf8')).toBe(infra.contents);
    expect(f.note).toHaveBeenCalledWith(expect.stringContaining('API: https://api.mintomo.com'));
  },
);

test('preserves existing app-release values without rereading infrastructure or asking for them', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  const infra = await infrastructure(f.root, 'different.mintomo.com');
  await fs.writeFile(infra.file, 'invalid infrastructure');
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).not.toHaveBeenCalled();
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('uses the configured infrastructure hostname ahead of local app configuration', async () => {
  const f = await fixture();
  await infrastructure(f.root, settings.apiHost);
  await fs.writeFile(
    path.join(f.root, 'app/Configuration/Remote.local.xcconfig'),
    'TCG_API_HOST = different.mintomo.com\n',
  );
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).not.toHaveBeenCalled();
  expect((await readAppSettings(f.directory)).apiHost).toBe(settings.apiHost);
});

test.each(['', 'api.example.com'])(
  'uses local app configuration when the infrastructure hostname is unusable: %s',
  async apiHost => {
    const f = await fixture();
    await infrastructure(f.root, apiHost);
    await fs.writeFile(
      path.join(f.root, 'app/Configuration/Remote.local.xcconfig'),
      `TCG_API_HOST = ${settings.apiHost}\n`,
    );
    await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
    expect(f.text).not.toHaveBeenCalled();
    expect(await readAppSettings(f.directory)).toEqual(settings);
  },
);

test('asks only for the hostname when none is configured', async () => {
  const f = await fixture();
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: 'Production API hostname (without https:// or a path)' }),
  );
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('asks for an absent team without asking again for a known hostname', async () => {
  const f = await fixture();
  await infrastructure(f.root, settings.apiHost);
  await fs.writeFile(path.join(f.root, 'app/Configuration/App.xcconfig'), 'DEVELOPMENT_TEAM =\n');
  f.text.mockResolvedValue(settings.teamID);
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Apple Developer team ID' }));
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('saves settings without an extra confirmation', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.confirm).not.toHaveBeenCalled();
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('explicit edit mode keeps known values as defaults and allows changing them', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  f.text
    .mockResolvedValueOnce(settings.teamID)
    .mockResolvedValueOnce('new.mintomo.com')
    .mockResolvedValueOnce(f.authentication.email);
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts, edit: true });
  expect(f.text).toHaveBeenCalledTimes(3);
  expect(f.text).toHaveBeenNthCalledWith(2, expect.objectContaining({ initialValue: settings.apiHost }));
  expect((await readAppSettings(f.directory)).apiHost).toBe('new.mintomo.com');
});

test('unreadable infrastructure stops with its explanation instead of asking for the hostname again', async () => {
  const f = await fixture();
  const infra = await infrastructure(f.root, settings.apiHost);
  await fs.writeFile(infra.file, 'invalid infrastructure');
  await expect(setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts })).rejects.toThrow(
    'Cannot safely read',
  );
  expect(f.text).not.toHaveBeenCalled();
  expect(await fs.readFile(infra.file, 'utf8')).toBe('invalid infrastructure');
});

async function linkedFixture() {
  const f = await fixture();
  const worktree = await worktreeFixture();
  await fs.mkdir(path.join(worktree.main, 'app/Configuration'), { recursive: true });
  await fs.copyFile(
    path.join(f.root, 'app/Configuration/App.xcconfig'),
    path.join(worktree.main, 'app/Configuration/App.xcconfig'),
  );
  worktree.git(['add', 'app/Configuration/App.xcconfig']);
  worktree.git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-m',
    'App configuration',
  ]);
  worktree.git(['worktree', 'add', '--detach', worktree.checkout]);

  return { ...f, ...worktree };
}

test.each(['json', 'native'] as const)(
  'finds ignored %s infrastructure settings in the primary checkout when run from a linked worktree',
  async format => {
    const f = await linkedFixture();
    const infra = await infrastructure(f.main, settings.apiHost, format);
    await setupAppRelease({ root: f.checkout, directory: f.directory, prompts: f.prompts });
    expect(f.text).not.toHaveBeenCalled();
    expect(await readAppSettings(f.directory)).toEqual(settings);
    expect(await fs.readFile(infra.file, 'utf8')).toBe(infra.contents);
  },
);

test('finds the primary checkout private app configuration when neither checkout has an infrastructure hostname', async () => {
  const f = await linkedFixture();
  await fs.writeFile(
    path.join(f.main, 'app/Configuration/Remote.local.xcconfig'),
    `TCG_API_HOST = ${settings.apiHost}\n`,
  );
  await setupAppRelease({ root: f.checkout, directory: f.directory, prompts: f.prompts });
  expect(f.text).not.toHaveBeenCalled();
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('keeps the current checkout infrastructure hostname ahead of the primary checkout value', async () => {
  const f = await linkedFixture();
  await infrastructure(f.checkout, settings.apiHost);
  await infrastructure(f.main, 'different.mintomo.com');
  await setupAppRelease({ root: f.checkout, directory: f.directory, prompts: f.prompts });
  expect(f.text).not.toHaveBeenCalled();
  expect(await readAppSettings(f.directory)).toEqual(settings);
});

test('new upload setup saves email and a masked app-specific password privately', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  await fs.rm(path.join(f.directory, 'app-store-connect.json'));
  f.text.mockResolvedValueOnce(f.authentication.email);
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'App Store Connect email' }));
  expect(f.password).toHaveBeenCalledExactlyOnceWith('App Store Connect app-specific password');
  expect(f.confirm).not.toHaveBeenCalled();
  expect(await readAppAuthentication(f.directory)).toEqual(f.authentication);
  expect((await fs.stat(path.join(f.directory, 'app-store-connect.json'))).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(f.note.mock.calls)).not.toContain(f.authentication.email);
  expect(JSON.stringify(f.note.mock.calls)).not.toContain(f.authentication.password);
});

test('reuses private upload credentials without asking for them again', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  await setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts });
  expect(f.text).not.toHaveBeenCalled();
  expect(f.password).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(await readAppAuthentication(f.directory)).toEqual(f.authentication);
});

test('rejects a regular Apple password without replacing private credentials', async () => {
  const f = await fixture();
  await saveAppSettings(f.directory, settings);
  f.text
    .mockResolvedValueOnce(settings.teamID)
    .mockResolvedValueOnce(settings.apiHost)
    .mockResolvedValueOnce(f.authentication.email);
  f.password.mockResolvedValueOnce('regular-password');
  await expect(
    setupAppRelease({ root: f.root, directory: f.directory, prompts: f.prompts, edit: true }),
  ).rejects.toThrow('Use an Apple app-specific password');
  expect(await readAppAuthentication(f.directory)).toEqual(f.authentication);
});
