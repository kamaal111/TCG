import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';

const repo = url.fileURLToPath(new URL('../', import.meta.url));

const sha = 'd'.repeat(40);

const plan = 'reviewed Terraform plan';

const planHash = crypto.createHash('sha256').update(plan).digest('hex');

async function fixture(t: Pick<TestContext, 'onTestFinished'>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-workflow audit-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const runner = path.join(root, 'runner temp');
  const directory = path.join(root, 'infra/environments/production');

  await fs.mkdir(bin);
  await fs.mkdir(runner);
  await fs.mkdir(path.join(directory, '.terraform'), { recursive: true });
  await fs.mkdir(path.join(root, '.github/scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(
    path.join(repo, '.github/scripts/infrastructure.sh'),
    path.join(root, '.github/scripts/infrastructure.sh'),
  );
  await fs.copyFile(
    path.join(repo, '.github/scripts/release-server.sh'),
    path.join(root, '.github/scripts/release-server.sh'),
  );
  await fs.copyFile(path.join(repo, 'scripts/deployment-ssh.sh'), path.join(root, 'scripts/deployment-ssh.sh'));
  await fs.writeFile(path.join(root, 'key'), 'fixture private key');
  await fs.writeFile(path.join(root, 'known_hosts'), 'fixture verified host');
  await fs.writeFile(
    path.join(root, 'release.env'),
    `TCG_DEPLOY_HOST=server.example.ts.net\nTCG_IMAGE_REPOSITORY=ghcr.io/example/tcg-server\nTCG_DEPLOY_KEY="${path.join(root, 'key')}"\nTCG_KNOWN_HOSTS="${path.join(root, 'known_hosts')}"\n`,
  );
  await fs.writeFile(path.join(root, 'mise.toml'), '[tools]\nnode = "26"\npnpm = "12.11.1"\n');
  const log = path.join(root, 'commands.jsonl');
  const output = path.join(root, 'output');
  const summary = path.join(root, 'summary');

  await fs.writeFile(log, '');
  await fs.writeFile(output, '');
  await fs.writeFile(summary, '');

  const command = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const entry = { tool, args };
if (tool === 'docker' && args[1] === 'build') entry.contextFiles = fs.readdirSync(args.at(-1));
if (tool === 'gpg') {
  entry.passphraseMatches = fs.readFileSync(3, 'utf8') === process.env.PLAN_KEY + '\\n';
  if (!process.env.FAIL_GPG) fs.copyFileSync(args.at(-1), args[args.indexOf('--output') + 1]);
}
if (tool === 'ssh') {
  const key = args[args.indexOf('-i') + 1];
  const hosts = args.find(arg => arg.startsWith('UserKnownHostsFile=')).split('=')[1];
  entry.key = fs.readFileSync(key, 'utf8');
  entry.hosts = fs.readFileSync(hosts, 'utf8');
  entry.mode = fs.statSync(key).mode & 0o777;
  console.error('private SSH diagnostic');
}
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(entry) + '\\n');
if (tool === 'just' && args[0] === 'infra-plan') {
  fs.writeFileSync('infra/environments/production/.terraform/review.tfplan', ${JSON.stringify(plan)});
  fs.writeFileSync('infra/environments/production/.terraform/review.commit', ${JSON.stringify(sha)});
}
if (tool === 'terraform') console.log('Readable reviewed plan');
if (tool === 'just') console.log('private Terraform diagnostic');
if (tool === 'git' && args[0] === 'rev-parse') console.log(${JSON.stringify(sha)});
if (tool === 'git' && args[0] === 'archive') {
  const output = args.find(arg => arg.startsWith('--output=')).slice('--output='.length);
  require('node:child_process').execFileSync('tar', ['-cf', output, 'mise.toml']);
}
if (tool === 'docker' && args[1] === 'build') {
  const target = args[args.indexOf('--target') + 1];
  if (target === process.env.FAIL_DOCKER_TARGET) process.exit(1);
  fs.writeFileSync(args[args.indexOf('--metadata-file') + 1], JSON.stringify({ 'containerimage.digest': process.env.INVALID_DIGEST || 'sha256:' + (target === 'runtime' ? 'a' : 'b').repeat(64) }));
}
if (tool === 'mise') {
  const separator = args.indexOf('--');
  const result = require('node:child_process').spawnSync(args[separator + 1], args.slice(separator + 2), { stdio: 'inherit' });
  process.exit(result.status);
}
if (tool === 'just' && args[0] === process.env.FAIL_JUST) process.exit(1);
if ((tool === 'gpg' && process.env.FAIL_GPG) || (tool === 'ssh' && process.env.FAIL_SSH) || (tool === 'git' && args[0] === 'merge-base' && process.env.FAIL_ANCESTRY)) process.exit(1);
`;

  for (const name of ['just', 'terraform', 'gpg', 'ssh', 'git', 'docker', 'mise', 'pnpm']) {
    await fs.writeFile(path.join(bin, name), command, { mode: 0o755 });
  }

  const run = (file: string, actions: string[], extra: NodeJS.ProcessEnv = {}) =>
    childProcess.spawnSync(file.endsWith('.ts') ? process.execPath : 'bash', [file, ...actions], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        RUNNER_TEMP: runner,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_REPOSITORY: 'Example/TCG',
        TF_INPUTS: '{"private":"fixture-only"}',
        PLAN_KEY: 'fixture-only passphrase',
        EXPECTED_HASH: planHash,
        ...extra,
      },
      encoding: 'utf8',
    });

  return {
    root,
    runner,
    directory,
    commands: () => fs.readFile(log, 'utf8'),
    output: () => fs.readFile(output, 'utf8'),
    summary: () => fs.readFile(summary, 'utf8'),
    infra: (action: string, env?: NodeJS.ProcessEnv) =>
      run(path.join(root, '.github/scripts/infrastructure.sh'), [action], env),
    release: (action: string, env?: NodeJS.ProcessEnv) =>
      run(path.join(repo, '.github/scripts/release-server.sh'), [action], env),
    metadata: (action: string, env?: NodeJS.ProcessEnv) =>
      run(path.join(repo, 'scripts/release-metadata.ts'), [action], env),
    localRelease: (env?: NodeJS.ProcessEnv, args: string[] = []) =>
      run(path.join(repo, 'scripts/release-server.sh'), args, {
        TCG_RELEASE_ENV_FILE: path.join(root, 'release.env'),
        TCG_DEPLOY_HOST: undefined,
        TCG_IMAGE_REPOSITORY: undefined,
        TCG_DEPLOY_KEY: undefined,
        TCG_KNOWN_HOSTS: undefined,
        TMPDIR: runner,
        ...env,
      }),
  };
}

test('plan outputs describe and hash the exact private saved plan', async t => {
  const f = await fixture(t);
  const result = f.infra('plan');

  expect(result.status).toBe(0);
  expect(await f.output()).toBe(`plan_hash=${planHash}\n`);
  expect(await f.summary()).toContain(planHash);
  expect(await f.summary()).not.toContain('Readable reviewed plan');
  expect(await fs.readFile(path.join(f.directory, '.terraform/review.txt'), 'utf8')).toBe('Readable reviewed plan\n');
  expect((await fs.stat(path.join(f.directory, 'terraform.tfvars.json'))).mode & 0o777).toBe(0o600);
  expect(result.stdout + result.stderr).not.toContain('fixture-only');
  expect(result.stdout + result.stderr).not.toContain('private Terraform diagnostic');
});

test('a local release verifies archived main sources and deploys both immutable Linux images', async t => {
  const f = await fixture(t);
  const result = f.localRelease();

  expect(result.status).toBe(0);
  expect(await f.commands()).toContain(`"--is-ancestor","${sha}","origin/main"`);
  expect(await f.commands()).toContain('"archive","--format=tar"');
  expect(await f.commands()).toContain('"contextFiles":["mise.toml"]');
  expect(await f.commands()).toContain('"install","--frozen-lockfile"');
  expect(await f.commands()).toContain('"args":["ready-server"]');
  expect(await f.commands()).toContain('"--platform","linux/amd64"');
  expect(await f.commands()).toContain(`"--tag","ghcr.io/example/tcg-server:${sha}"`);
  expect(await f.commands()).toContain(
    `release ghcr.io/example/tcg-server@sha256:${'a'.repeat(64)} ghcr.io/example/tcg-server-migrations@sha256:${'b'.repeat(64)} private false`,
  );
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('a local release preserves shell variables over environment-file values', async t => {
  const f = await fixture(t);
  const result = f.localRelease({ TCG_IMAGE_REPOSITORY: 'ghcr.io/example/override-server' });

  expect(result.status).toBe(0);
  expect(await f.commands()).toContain(`"--tag","ghcr.io/example/override-server:${sha}"`);
  expect(await f.commands()).not.toContain(`"--tag","ghcr.io/example/tcg-server:${sha}"`);
});

test('a local release passes public exposure and rollback confirmation to the dispatcher', async t => {
  const f = await fixture(t);
  const result = f.localRelease({}, ['origin/main', 'public', 'true']);

  expect(result.status).toBe(0);
  expect(await f.commands()).toContain(
    `release ghcr.io/example/tcg-server@sha256:${'a'.repeat(64)} ghcr.io/example/tcg-server-migrations@sha256:${'b'.repeat(64)} public true`,
  );
});

test.each([
  ['origin/main', 'invalid', 'false'],
  ['origin/main', 'private', 'invalid'],
  ['origin/main', 'private', 'false', 'extra'],
])('a local release rejects invalid arguments %j before running commands', async (...args) => {
  const f = await fixture({ onTestFinished });
  const result = f.localRelease({}, args);

  expect(result.status).toBe(64);
  expect(await f.commands()).toBe('');
});

test('a local release accepts a missing optional environment file when shell configuration is complete', async t => {
  const f = await fixture(t);

  const result = f.localRelease({
    TCG_RELEASE_ENV_FILE: path.join(f.root, 'missing.env'),
    TCG_DEPLOY_HOST: 'server.example.ts.net',
    TCG_IMAGE_REPOSITORY: 'ghcr.io/example/tcg-server',
    TCG_DEPLOY_KEY: path.join(f.root, 'key'),
    TCG_KNOWN_HOSTS: path.join(f.root, 'known_hosts'),
  });

  expect(result.status).toBe(0);
  expect(await f.commands()).toContain('"tool":"ssh"');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('a local release rejects an environment-file read failure before running commands', async t => {
  const f = await fixture(t);
  const result = f.localRelease({ TCG_RELEASE_ENV_FILE: f.root });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Release environment file must be a readable regular file.');
  expect(await f.commands()).toBe('');
});

test('a local release refuses an unmerged revision before publishing or deploying', async t => {
  const f = await fixture(t);

  expect(f.localRelease({ FAIL_ANCESTRY: '1' }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"tool":"docker"');
  expect(await f.commands()).not.toContain('"tool":"ssh"');
});

test('CI checks out the immutable revision only after the trusted main guard accepts it', async t => {
  const f = await fixture(t);

  expect(f.release('checkout-revision', { RELEASE_REVISION: 'main' }).status).toBe(0);
  expect(await f.commands()).toContain(`"args":["checkout","--detach","${sha}"]`);
});

test('CI rejects an unmerged revision before checking out its scripts', async t => {
  const f = await fixture(t);

  expect(f.release('checkout-revision', { RELEASE_REVISION: 'unmerged', FAIL_ANCESTRY: '1' }).status).toBe(1);
  expect(await f.commands()).not.toContain('"checkout"');
});

test('failed local verification prevents publishing and removes its temporary sources', async t => {
  const f = await fixture(t);

  expect(f.localRelease({ FAIL_JUST: 'ready-server' }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"--push"');
  expect(await f.commands()).not.toContain('"tool":"ssh"');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('a failed migration-image publish prevents local deployment', async t => {
  const f = await fixture(t);

  expect(f.localRelease({ FAIL_DOCKER_TARGET: 'migration' }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"tool":"ssh"');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('invalid registry digests prevent local SSH deployment', async t => {
  const f = await fixture(t);

  expect(f.localRelease({ INVALID_DIGEST: 'latest' }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"tool":"ssh"');
});

test('a failed local SSH deployment removes its temporary sources and metadata', async t => {
  const f = await fixture(t);
  const result = f.localRelease({ FAIL_SSH: '1' });

  expect(result.status).not.toBe(0);
  expect(await f.commands()).toContain('"tool":"ssh"');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('the manual workflow invokes only the explicit migration operation', async t => {
  const f = await fixture(t);

  const result = f.release('', {
    OPERATION: 'migrate',
    DEPLOY_KEY: 'fixture private key',
    KNOWN_HOSTS: 'fixture verified host',
    DEPLOY_HOST: 'server.example.ts.net',
    MIGRATION_IMAGE: 'fixture-migration',
    RUNTIME_IMAGE: undefined,
    EXPOSURE: undefined,
    ROLLBACK: undefined,
    TMPDIR: f.runner,
  });

  expect(result.status).toBe(0);
  expect(await f.commands()).toContain('migrate fixture-migration');
  expect(await f.commands()).not.toContain('release fixture');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
});

test('an encrypted plan survives plaintext cleanup and applies only after hash verification', async t => {
  const f = await fixture(t);

  expect(f.infra('plan').status).toBe(0);
  expect(f.infra('encrypt').status).toBe(0);
  expect(f.infra('cleanup').status).toBe(0);
  expect(await fs.readdir(path.join(f.directory, '.terraform'))).toStrictEqual([]);
  expect(f.infra('apply').status).toBe(0);
  expect(await fs.readFile(path.join(f.directory, '.terraform/review.commit'), 'utf8')).toBe(sha);
  expect(await f.commands()).toContain('"args":["infra-apply"]');
  expect(await f.commands()).toContain('"passphraseMatches":true');
  expect(await f.commands()).not.toContain('fixture-only passphrase');
});

test('failed Terraform commands keep diagnostics out of public logs and summaries', async t => {
  const f = await fixture(t);
  const result = f.infra('plan', { FAIL_JUST: 'infra-plan' });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Reproduce locally with private inputs');
  expect(result.stdout + result.stderr).not.toContain('private Terraform diagnostic');
  expect(await f.summary()).toBe('');
  expect(await f.output()).toBe('');
});

test('a different approval hash prevents infrastructure apply', async t => {
  const f = await fixture(t);

  expect(f.infra('plan').status).toBe(0);
  expect(f.infra('encrypt').status).toBe(0);
  expect(f.infra('apply', { EXPECTED_HASH: '0'.repeat(64) }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"args":["infra-apply"]');
});

test('apply keeps Terraform diagnostics out of public workflow output', async t => {
  const f = await fixture(t);

  expect(f.infra('plan').status).toBe(0);
  expect(f.infra('encrypt').status).toBe(0);
  const result = f.infra('apply');

  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).not.toContain('private Terraform diagnostic');
});

test('a decryption failure prevents infrastructure apply', async t => {
  const f = await fixture(t);

  expect(f.infra('apply', { FAIL_GPG: '1' }).status).not.toBe(0);
  expect(await f.commands()).not.toContain('"args":["infra-apply"]');
});

test.each(['', 'unknown', 'toString', 'constructor', '__proto__'])(
  'release metadata rejects unsupported action %j',
  async action => {
    const f = await fixture({ onTestFinished });
    const result = f.metadata(action);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('Expected repository, build, digest, names, or refs.');
    expect(await f.output()).toBe('');
  },
);

test('release metadata rejects unknown options before writing outputs', async t => {
  const f = await fixture(t);
  const result = f.metadata('--unexpected');

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Unknown option');
  expect(await f.output()).toBe('');
});

test('release names reuse mise versions and the checked-out commit', async t => {
  const f = await fixture(t);

  expect(f.metadata('names').status).toBe(0);
  expect(await f.output()).toBe(`repository=ghcr.io/example/tcg-server\nsha=${sha}\nnode=26\npnpm=12.11.1\n`);
});

test('release outputs preserve both immutable digests', async t => {
  const f = await fixture(t);
  const runtime = `sha256:${'a'.repeat(64)}`;
  const migration = `sha256:${'b'.repeat(64)}`;

  expect(
    f.metadata('refs', {
      REPOSITORY: 'ghcr.io/example/tcg-server',
      RUNTIME_DIGEST: runtime,
      MIGRATION_DIGEST: migration,
    }).status,
  ).toBe(0);
  expect(await f.output()).toBe(
    `runtime=ghcr.io/example/tcg-server@${runtime}\nmigration=ghcr.io/example/tcg-server-migrations@${migration}\n`,
  );
});

test('malformed digest input cannot inject GitHub outputs', async t => {
  const f = await fixture(t);

  expect(
    f.metadata('refs', {
      REPOSITORY: 'ghcr.io/example/tcg-server',
      RUNTIME_DIGEST: 'latest\nextra=unsafe',
      MIGRATION_DIGEST: `sha256:${'b'.repeat(64)}`,
    }).status,
  ).not.toBe(0);
  expect(await f.output()).toBe('');
});

test('a revision outside main is rejected by the ancestry guard', async t => {
  const f = await fixture(t);

  expect(f.release('verify-revision', { FAIL_ANCESTRY: '1' }).status).toBe(1);
  expect(await f.commands()).toContain('"args":["fetch","origin","main"]');
  expect(await f.commands()).toContain(`"args":["merge-base","--is-ancestor","${sha}","origin/main"]`);
});

test.each(['', '1'])('SSH deployment cleans private files after success or failure (%s)', async failure => {
  const f = await fixture({ onTestFinished });

  const result = f.release('deploy', {
    DEPLOY_KEY: 'fixture private key',
    KNOWN_HOSTS: 'fixture verified host',
    DEPLOY_HOST: 'server.example.ts.net',
    RUNTIME_IMAGE: 'fixture-runtime',
    MIGRATION_IMAGE: 'fixture-migration',
    EXPOSURE: 'private',
    ROLLBACK: 'false',
    FAIL_SSH: failure,
    TMPDIR: f.runner,
  });

  expect(result.status).toBe(Number(failure || '0'));
  expect(await f.commands()).toContain('StrictHostKeyChecking=yes');
  expect(await f.commands()).toContain('"mode":384');
  expect(await f.commands()).toContain('release fixture-runtime fixture-migration private false');
  expect(await fs.readdir(f.runner)).toStrictEqual([]);
  expect(result.stdout + result.stderr).not.toContain('fixture private key');
  expect(result.stdout + result.stderr).not.toContain('private SSH diagnostic');
});
