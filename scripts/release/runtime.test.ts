import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';
import z from 'zod';

import { releaseFromTerminal } from './runtime.ts';
import type { Prompts } from '../infra/prompts.ts';

const repository = url.fileURLToPath(new URL('../../', import.meta.url));
const runtime = `ghcr.io/example/server@sha256:${'a'.repeat(64)}`;
const migration = `ghcr.io/example/server-migrations@sha256:${'b'.repeat(64)}`;

async function fixture(t: Pick<TestContext, 'onTestFinished'>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-guided release-'));
  t.onTestFinished(() => fs.rm(temporary, { recursive: true, force: true }));
  t.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const root = path.join(temporary, 'repo');
  const configDirectory = path.join(temporary, 'private config');
  const origin = path.join(temporary, 'origin');
  const bin = path.join(temporary, 'bin');
  await fs.mkdir(root);
  await fs.mkdir(configDirectory);
  await fs.mkdir(bin);
  const realJust = childProcess.execFileSync('which', ['just'], { encoding: 'utf8' }).trim();

  const git = (args: string[], cwd = root) => {
    return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };

  git(['init', '--bare', origin]);
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Release Test']);
  git(['config', 'user.email', 'release@example.com']);
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules\ninfra/environments/production/terraform.tfvars\n');
  await fs.writeFile(path.join(root, 'mise.toml'), '[tools]\nnode = "26"\npnpm = "12.11.1"\n');

  for (const file of [
    'scripts/infrastructure.sh',
    'scripts/check-infrastructure-plan.ts',
    'scripts/release-server.sh',
    'scripts/release-metadata.ts',
    'scripts/mise-tools.ts',
    'scripts/deployment-ssh.sh',
    '.github/scripts/release-server.sh',
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(repository, file), path.join(root, file));
  }

  await fs.mkdir(path.join(root, 'infra/environments/production'), { recursive: true });
  await fs.writeFile(path.join(root, 'infra/environments/production/main.tf'), '# fixture configuration');
  git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial release fixture']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '-u', 'origin', 'main']);
  const sha = git(['rev-parse', 'HEAD']);
  await fs.symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'));
  await fs.writeFile(path.join(configDirectory, 'deploy-key'), 'fixture key', { mode: 0o600 });
  await fs.writeFile(path.join(configDirectory, 'known-hosts'), 'fixture verified host', { mode: 0o600 });
  const releaseFile = path.join(configDirectory, 'release.env');
  await fs.writeFile(releaseFile, '# fixture settings are supplied through explicit overrides\n');
  const log = path.join(temporary, 'commands.jsonl');
  await fs.writeFile(log, '');
  const stateFile = path.join(temporary, 'remote.json');

  const state = {
    protocol: 1,
    busy: false,
    hostname: 'api.example.com',
    repository: 'ghcr.io/example/server',
    runtime: null,
    revision: null,
    operationsRevision: sha,
    fingerprint: 'c'.repeat(64),
  };

  await fs.writeFile(stateFile, JSON.stringify(state));

  const executable = `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
const state = JSON.parse(fs.readFileSync(process.env.TCG_TEST_STATE, 'utf8'));
let head = null;
if (process.cwd().endsWith('/operations')) head = cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
fs.appendFileSync(process.env.TCG_TEST_LOG, JSON.stringify({tool, args, cwd:process.cwd(), head})+'\\n');
if (tool === 'just' && args.includes('--justfile')) {
 const result = cp.spawnSync(process.env.TCG_TEST_JUST, args, {stdio:'inherit'}); process.exit(result.status);
}
if (tool === 'mise') {
 const index = args.indexOf('--');
 const result = cp.spawnSync(args[index+1],args.slice(index+2),{stdio:'inherit'}); process.exit(result.status);
}
if (tool === 'pnpm') fs.symlinkSync(process.env.TCG_TEST_MODULES, 'node_modules');
if (tool === 'docker' && args[1] === 'build') {
 const target = args[args.indexOf('--target')+1];
 const context = args.at(-1);
 if (fs.existsSync(path.join(context, 'infra/environments/production/terraform.tfvars'))) process.exit(91);
 fs.writeFileSync(args[args.indexOf('--metadata-file')+1], JSON.stringify({'containerimage.digest':'sha256:'+(target==='runtime'?'a':'b').repeat(64)}));
}
if (tool === 'docker' && args[0] === 'image') console.log(JSON.stringify([{Config:{Labels:{'org.opencontainers.image.revision':process.env.TCG_TEST_LABEL || process.env.TCG_TEST_SHA}}}]));
if (tool === 'terraform') {
 const action=args[1];
 const dir=args[0].slice('-chdir='.length);
 if (action==='plan') {fs.mkdirSync(path.join(dir,'.terraform'),{recursive:true});fs.writeFileSync(path.join(dir,'.terraform/review.tfplan'),'reviewed fixture plan');}
 if (action==='show') console.log(JSON.stringify(process.env.TCG_TEST_NO_PLAN_CHANGES ? {} : process.env.TCG_TEST_RESOURCE_ONLY ? {resource_changes:[{address:'module.tcg.firewall',type:'digitalocean_firewall',change:{actions:['update']}}]} : {output_changes:{inventory:{actions:['update']}}}));
 if (action==='apply' && process.env.TCG_TEST_FAIL_APPLY) process.exit(1);
 if (action==='output') console.log('{}');
}
if (tool === 'ansible-playbook') {
 state.operationsRevision=head; state.upgraded=true; fs.writeFileSync(process.env.TCG_TEST_STATE,JSON.stringify(state));
}
if (tool === 'ssh') {
 const request = args.at(-1).split(' ');
 if (request[0] === 'status') {if(process.env.TCG_TEST_OLD_HOST && !state.upgraded) process.exit(64);console.log(JSON.stringify(state));}
 if (request[0] === 'migration-status') console.log(JSON.stringify({protocol:1,status:'ready',pending:0}));
 if (request[0] === 'release-checked') {
   if (process.env.TCG_TEST_FAIL_DEPLOY) {console.error('Fixture deployment failure');process.exit(1);}
   state.runtime=request[1]; state.revision=process.env.TCG_TEST_SHA; fs.writeFileSync(process.env.TCG_TEST_STATE,JSON.stringify(state));
 }
 if (request[0] === 'check') console.log('Release checks passed.');
}
`;

  for (const tool of ['just', 'mise', 'pnpm', 'docker', 'ssh', 'terraform', 'ansible-playbook']) {
    await fs.writeFile(path.join(bin, tool), executable, { mode: 0o755 });
  }

  for (const [key, value] of Object.entries({
    PATH: `${bin}:${process.env.PATH}`,
    TCG_DEPLOY_HOST: 'server.example.ts.net',
    TCG_DEPLOY_KEY: path.join(configDirectory, 'deploy-key'),
    TCG_KNOWN_HOSTS: path.join(configDirectory, 'known-hosts'),
    TCG_IMAGE_REPOSITORY: 'ghcr.io/example/server',
    TF_CLOUD_ORGANIZATION: 'fixture',
    TF_WORKSPACE: 'fixture',
    TCG_DEPLOY_PUBLIC_KEY: 'fixture key',
    TCG_TEST_STATE: stateFile,
    TCG_TEST_LOG: log,
    TCG_TEST_SHA: sha,
    TCG_TEST_JUST: realJust,
    TCG_TEST_MODULES: path.join(repository, 'node_modules'),
  })) {
    vi.stubEnv(key, value);
  }

  const confirm = vi
    .fn<Prompts['confirm']>()
    .mockImplementation(async message => message !== 'Review an infrastructure plan?');

  const note = vi.fn<Prompts['note']>();

  const prompts: Prompts = {
    confirm,
    text: vi.fn<Prompts['text']>(),
    password: vi.fn<Prompts['password']>(),
    select: vi.fn<Prompts['select']>(),
    multiselect: vi.fn<Prompts['multiselect']>(),
    note,
  };

  const readLog = async () => {
    return z
      .array(z.object({ tool: z.string(), args: z.array(z.string()), cwd: z.string(), head: z.string().nullable() }))
      .parse(
        (await fs.readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map(line => JSON.parse(line)),
      );
  };

  return {
    root,
    configDirectory,
    sha,
    confirm,
    note,
    git,
    releaseFile,
    run: (revision = 'origin/main') => releaseFromTerminal({ root, configDirectory, revision, prompts }),
    commands: readLog,
    published: async () => {
      return (await readLog()).filter(command => command.tool === 'docker' && command.args.includes('--push'));
    },
    deployed: async () => {
      return (await readLog()).filter(
        command => command.tool === 'ssh' && command.args.at(-1)?.startsWith('release-checked'),
      );
    },
    state: async () => JSON.parse(await fs.readFile(stateFile, 'utf8')),
  };
}

test('a release pins main, publishes isolated sources and saves private resumable progress', async t => {
  const f = await fixture(t);
  await f.run();
  expect(await f.published()).toHaveLength(2);
  expect(await f.state()).toMatchObject({ runtime, revision: f.sha });
  const directory = path.join(f.configDirectory, 'releases');
  const files = await fs.readdir(directory);
  const checkpoint = path.join(directory, z.string().parse(files.find(file => file.endsWith('.json'))));
  expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(checkpoint)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await fs.readFile(checkpoint, 'utf8'))).toMatchObject({
    sha: f.sha,
    complete: true,
    artifacts: { runtime, migration },
  });
}, 15_000);

test('a retry verifies saved images and live state without rebuilding or restarting an installed release', async t => {
  const f = await fixture(t);
  await f.run();
  await f.run();
  expect(await f.published()).toHaveLength(2);
  expect(await f.deployed()).toHaveLength(1);
}, 15_000);

test('a failed deployment resumes the pinned release even when main has advanced', async t => {
  const f = await fixture(t);
  vi.stubEnv('TCG_TEST_FAIL_DEPLOY', '1');
  await expect(f.run()).rejects.toThrow('This step failed');
  await fs.writeFile(path.join(f.root, 'new-change'), 'later application change');
  f.git(['add', 'new-change']);
  f.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Later fixture commit']);
  f.git(['push', 'origin', 'main']);
  vi.stubEnv('TCG_TEST_FAIL_DEPLOY', '');
  await f.run();
  expect(f.confirm).toHaveBeenCalledWith(`Resume the unfinished release ${f.sha.slice(0, 12)}?`, true);
  expect(f.note).not.toHaveBeenCalledWith(expect.stringContaining('Later fixture commit'));
  expect(f.note).toHaveBeenCalledWith(expect.stringContaining('Initial release fixture'));
  expect(await f.published()).toHaveLength(2);
  expect(await f.state()).toMatchObject({ revision: f.sha });
}, 15_000);

test('changed local settings require fresh review rather than using a previous checkpoint', async t => {
  const f = await fixture(t);
  await f.run();
  await fs.appendFile(f.releaseFile, 'UNRELATED_SETTING=changed\n');
  await f.run();
  expect(await f.published()).toHaveLength(4);
}, 15_000);

test('rotated runtime credentials offer server setup even when infrastructure review is skipped and redeploy the same image', async t => {
  const f = await fixture(t);
  await f.run();
  await fs.writeFile(
    path.join(f.configDirectory, 'infrastructure.env'),
    'SCRYDEX_CLIENT=real\nSCRYDEX_API_KEY=fixture-rotated-key\nSCRYDEX_TEAM_ID=fixture-team\n',
    { mode: 0o600 },
  );
  await f.run();
  expect(f.confirm).toHaveBeenCalledWith('Apply saved settings and update deployment scripts on the server?', false);
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(1);
  expect(
    (await f.commands()).filter(command => command.tool === 'terraform' && command.args.includes('plan')),
  ).toHaveLength(0);
  expect(await f.deployed()).toHaveLength(2);
}, 15_000);

test('a failed settings deployment resumes by recreating the installed image without losing the pending configuration', async t => {
  const f = await fixture(t);
  await f.run();
  await fs.writeFile(path.join(f.configDirectory, 'infrastructure.env'), 'SCRYDEX_CLIENT=static\n', { mode: 0o600 });
  vi.stubEnv('TCG_TEST_FAIL_DEPLOY', '1');
  await expect(f.run()).rejects.toThrow('This step failed');
  vi.stubEnv('TCG_TEST_FAIL_DEPLOY', '');
  await f.run();
  expect(await f.deployed()).toHaveLength(3);
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(1);
}, 15_000);

test('a source-label mismatch on resume prevents another deployment', async t => {
  const f = await fixture(t);
  await f.run();
  vi.stubEnv('TCG_TEST_LABEL', 'e'.repeat(40));
  await expect(f.run()).rejects.toThrow('source label differs');
  expect(await f.deployed()).toHaveLength(1);
}, 15_000);

test('older application releases still configure the host from the newly fetched main revision', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'operations-change'), 'new management revision');
  f.git(['add', 'operations-change']);
  f.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Update release tooling fixture']);
  f.git(['push', 'origin', 'main']);
  const operations = f.git(['rev-parse', 'HEAD']);
  f.confirm.mockResolvedValue(true);
  await f.run(f.sha);
  expect(await f.state()).toMatchObject({ revision: f.sha, operationsRevision: operations });
  expect(await f.published()).toHaveLength(2);
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toEqual([
    expect.objectContaining({ head: operations }),
  ]);
}, 15_000);

test('output-only infrastructure changes require an explicit apply approval', async t => {
  const f = await fixture(t);
  f.confirm.mockImplementation(async message => {
    return (
      !message.startsWith('Apply this infrastructure') &&
      message !== 'Apply saved settings and update deployment scripts on the server?'
    );
  });
  await f.run();
  expect(f.confirm).toHaveBeenCalledWith('Apply this infrastructure plan?', false);
  expect(
    (await f.commands()).filter(command => command.tool === 'terraform' && command.args.includes('apply')),
  ).toHaveLength(0);
  expect(await f.deployed()).toHaveLength(1);
}, 15_000);

test('retrying a failed infrastructure apply always creates a new plan', async t => {
  const f = await fixture(t);
  f.confirm.mockResolvedValue(true);
  vi.stubEnv('TCG_TEST_FAIL_APPLY', '1');
  await expect(f.run()).rejects.toThrow('This step failed');
  vi.stubEnv('TCG_TEST_FAIL_APPLY', '');
  await f.run();
  expect(
    (await f.commands()).filter(command => command.tool === 'terraform' && command.args.includes('plan')),
  ).toHaveLength(2);
  expect(await f.deployed()).toHaveLength(1);
}, 15_000);

test('the first guided release upgrades older host tools only after approval', async t => {
  const f = await fixture(t);
  vi.stubEnv('TCG_TEST_OLD_HOST', '1');
  await f.run();
  expect(f.confirm).toHaveBeenCalledWith('Apply saved settings and update deployment scripts on the server?', false);
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(1);
  expect(await f.deployed()).toHaveLength(1);
}, 15_000);

test('editing local settings during deployment approval stops the mutation', async t => {
  const f = await fixture(t);
  f.confirm.mockImplementation(async message => {
    if (message.startsWith('Deploy this release?')) {
      await fs.appendFile(f.releaseFile, 'CHANGED_DURING_APPROVAL=yes\n');
    }

    return message !== 'Review an infrastructure plan?';
  });
  await expect(f.run()).rejects.toThrow('Local settings changed');
  expect(await f.deployed()).toHaveLength(0);
}, 15_000);

test('a first-run server update is not offered again after an unchanged infrastructure plan', async t => {
  const f = await fixture(t);
  vi.stubEnv('TCG_TEST_OLD_HOST', '1');
  vi.stubEnv('TCG_TEST_NO_PLAN_CHANGES', '1');
  f.confirm.mockResolvedValue(true);
  await f.run();
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(1);
  expect(
    f.confirm.mock.calls.filter(
      ([message]) => message === 'Apply saved settings and update deployment scripts on the server?',
    ),
  ).toHaveLength(1);
}, 15_000);

test('reviewing an unchanged plan after a successful release does not ask to reapply server settings', async t => {
  const f = await fixture(t);
  await f.run();
  f.confirm.mockClear().mockResolvedValue(true);
  vi.stubEnv('TCG_TEST_NO_PLAN_CHANGES', '1');
  await f.run();
  expect(f.confirm).not.toHaveBeenCalledWith(
    'Apply saved settings and update deployment scripts on the server?',
    false,
  );
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(0);
}, 15_000);

test('new infrastructure applied after the first-run setup still offers to apply the updated server settings', async t => {
  const f = await fixture(t);
  vi.stubEnv('TCG_TEST_OLD_HOST', '1');
  f.confirm.mockResolvedValue(true);
  await f.run();
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(2);
  expect(
    f.confirm.mock.calls.filter(
      ([message]) => message === 'Apply saved settings and update deployment scripts on the server?',
    ),
  ).toHaveLength(2);
}, 15_000);

test('applying a resource-only plan does not reapply unchanged server settings after the first-run update', async t => {
  const f = await fixture(t);
  vi.stubEnv('TCG_TEST_OLD_HOST', '1');
  vi.stubEnv('TCG_TEST_RESOURCE_ONLY', '1');
  f.confirm.mockResolvedValue(true);
  await f.run();
  expect((await f.commands()).filter(command => command.tool === 'ansible-playbook')).toHaveLength(1);
}, 15_000);
