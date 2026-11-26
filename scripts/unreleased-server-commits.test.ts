import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const cli = url.fileURLToPath(new URL('./unreleased-server-commits.ts', import.meta.url));
const justfile = url.fileURLToPath(new URL('../justfile', import.meta.url));

async function createRepository() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-inspection history-'));
  const root = path.join(directory, 'repository');
  await fs.mkdir(root);

  const git = (...args: string[]) => {
    return childProcess
      .execFileSync('/usr/bin/git', args, {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Release Test',
          GIT_AUTHOR_EMAIL: 'release@example.com',
          GIT_COMMITTER_NAME: 'Release Test',
          GIT_COMMITTER_EMAIL: 'release@example.com',
        },
      })
      .trim();
  };

  const commit = (message: string) => {
    return git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '--allow-empty',
      '-m',
      message,
    );
  };

  git('init', '-b', 'main');
  commit('Initial release');
  commit('feat(app): add search');
  const [selected, base] = git('rev-list', '--max-count=2', 'HEAD').split('\n');
  assert(selected != null && base != null);
  git('remote', 'add', 'origin', root);

  return { directory, root, base, selected };
}

let repository: Awaited<ReturnType<typeof createRepository>>;

beforeAll(async () => {
  repository = await createRepository();

  return () => fs.rm(repository.directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-inspection test-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repository');
  const bin = path.join(directory, 'bin');
  const config = path.join(directory, 'private settings');
  await Promise.all([fs.cp(repository.root, root, { recursive: true }), fs.mkdir(bin), fs.mkdir(config)]);
  const { base, selected } = repository;
  await fs.writeFile(path.join(config, 'key'), 'fixture key');
  await fs.writeFile(path.join(config, 'hosts'), 'fixture hosts');
  await fs.writeFile(
    path.join(config, 'release.env'),
    `TCG_DEPLOY_HOST=fixture.ts.net\nTCG_DEPLOY_KEY="${path.join(config, 'key')}"\nTCG_KNOWN_HOSTS="${path.join(config, 'hosts')}"\nTCG_IMAGE_REPOSITORY=ghcr.io/example/server\n`,
  );
  const log = path.join(directory, 'commands.log');
  await fs.writeFile(log, '');

  const state = {
    protocol: 1,
    busy: false,
    hostname: 'api.example.com',
    repository: 'ghcr.io/example/server',
    runtime: `ghcr.io/example/server@sha256:${'a'.repeat(64)}`,
    revision: base,
    operationsRevision: base,
    fingerprint: 'b'.repeat(64),
  };

  const wrapper = `#!/bin/sh
tool="\${0##*/}"
printf '%s\\n' "$tool $*" >> "$TEST_COMMANDS"
case "$tool" in
  git) exec /usr/bin/git -C "$TEST_REPO" "$@" ;;
  ssh)
    if [ -n "$TEST_SSH_FAIL" ]; then exit 255; fi
    printf '%s\\n' "$TEST_STATUS"
    ;;
  *) exit 99 ;;
esac
`;

  for (const tool of ['git', 'ssh', 'docker', 'terraform']) {
    await fs.writeFile(path.join(bin, tool), wrapper, { mode: 0o755 });
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TCG_')));

  const run = (args: string[], overrides: NodeJS.ProcessEnv) => {
    return childProcess.spawnSync(
      'just',
      ['--justfile', justfile, 'unreleased-server-commits', '--config-dir', config, ...args],
      {
        encoding: 'utf8',
        env: {
          ...env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_COMMANDS: log,
          TEST_REPO: root,
          TEST_STATUS: JSON.stringify(state),
          ...overrides,
        },
      },
    );
  };

  return { config, run, state, base, selected, log };
}

test('inspection works without a terminal or Docker and only requests remote status', { timeout: 10_000 }, async () => {
  const f = await fixture();
  const result = f.run([], {});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Commits to release (1):\n${f.selected.slice(0, 7)} feat(app): add search`);
  const log = await fs.readFile(f.log, 'utf8');
  expect(log).toContain('git fetch origin main\n');
  expect(log).toMatch(/^ssh .* status$/m);
  expect(log).not.toMatch(/docker|terraform|release-checked|migrate|worktree/);
  expect(await fs.readdir(f.config)).toEqual(['hosts', 'key', 'release.env']);
});

test('explicit older selection reports an empty comparison', async () => {
  const f = await fixture();
  const result = f.run([f.base], {});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('No unreleased commits.');
  expect(result.stdout).not.toContain('feat(app): add search');
});

test('SSH failure cannot be mistaken for no unreleased commits', async () => {
  const f = await fixture();
  const result = f.run([], { TEST_SSH_FAIL: '1' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Commit comparison unavailable');
  expect(result.stdout).not.toContain('No unreleased commits.');
});

test('malformed host status fails comparison', async () => {
  const f = await fixture();
  const result = f.run([], { TEST_STATUS: '{}' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Commit comparison unavailable');
});

test('unavailable deployed history fails comparison', async () => {
  const f = await fixture();
  const result = f.run([], { TEST_STATUS: JSON.stringify({ ...f.state, revision: 'a'.repeat(40) }) });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Commit comparison unavailable');
});

test('mismatched host registries fail before presenting a comparison', async () => {
  const f = await fixture();
  const result = f.run([], { TEST_STATUS: JSON.stringify({ ...f.state, repository: 'ghcr.io/other/server' }) });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('host registry differs');
});

test('help runs without settings or an interactive terminal', () => {
  const result = childProcess.spawnSync('just', ['--justfile', justfile, 'unreleased-server-commits', '--help'], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('origin/main');
  expect(result.stdout).toContain('$HOME/.config/tcg');
});

test.each([{ args: ['--unknown'] }, { args: ['one', 'two'] }, { args: ['--config-dir', ''] }])(
  'invalid arguments exit 64: $args',
  ({ args }) => {
    const result = childProcess.spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(64);
  },
);
