import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const just = childProcess.spawnSync('which', ['just'], { encoding: 'utf8' }).stdout.trim();

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg namu-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(url.fileURLToPath(new URL('../justfile', import.meta.url)), path.join(root, 'justfile'));
  await fs.copyFile(
    url.fileURLToPath(new URL('./install-namu.sh', import.meta.url)),
    path.join(root, 'scripts/install-namu.sh'),
  );
  await fs.writeFile(calls, '');

  const namu = `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(process.env.CALLS, JSON.stringify(['namu', ...process.argv.slice(2)]) + '\\n');
console.log('checkout path');
console.error('namu diagnostic');
process.exit(Number(process.env.NAMU_EXIT));
`;

  await fs.writeFile(path.join(root, 'namu'), namu, { mode: 0o755 });
  await fs.writeFile(path.join(bin, 'namu'), namu, { mode: 0o755 });
  await fs.writeFile(
    path.join(bin, 'brew'),
    `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
fs.appendFileSync(process.env.CALLS, JSON.stringify(['brew', ...process.argv.slice(2)]) + '\\n');
console.log('brew progress');
if (process.env.BREW_EXIT !== '0') process.exit(Number(process.env.BREW_EXIT));
if (process.env.BREW_INSTALL === 'true') fs.copyFileSync(path.join(process.env.FIXTURE, 'namu'), path.join(process.env.FIXTURE, 'bin/namu'));
`,
    { mode: 0o755 },
  );

  const run = (args: string[], overrides: NodeJS.ProcessEnv = {}) => {
    return childProcess.spawnSync(just, args, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        CALLS: calls,
        FIXTURE: root,
        NAMU_EXIT: '0',
        BREW_EXIT: '0',
        BREW_INSTALL: 'true',
        ...overrides,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
  };

  const readCalls = () => fs.readFile(calls, 'utf8');

  return { root, bin, run, readCalls };
}

test('uses an existing namu without Homebrew and forwards creation arguments unchanged', async () => {
  const f = await fixture();
  const args = ['create', 'feature/pricing', '--base', 'feature/cards', '--no-focus'];
  const result = f.run(['create-worktree', ...args.slice(1)]);

  expect(result.status).toBe(0);
  expect(await f.readCalls()).toBe(`${JSON.stringify(['namu', ...args])}\n`);
  expect(result.stdout).toBe('checkout path\n');
  expect(result.stderr).toContain('namu diagnostic');
});

test('installs missing namu once before creation and keeps installation progress off stdout', async () => {
  const f = await fixture();
  await fs.unlink(path.join(f.bin, 'namu'));
  const created = f.run(['create-worktree', 'feature/cards']);
  const second = f.run(['create-worktree', 'feature/pricing']);

  expect(created.status).toBe(0);
  expect(second.status).toBe(0);
  expect(created.stdout).toBe('checkout path\n');
  expect(created.stderr).toContain('brew progress');
  expect(await f.readCalls()).toBe(
    `${JSON.stringify(['brew', 'install', 'kamaal111/tap/namu'])}\n${JSON.stringify(['namu', 'create', 'feature/cards'])}\n${JSON.stringify(['namu', 'create', 'feature/pricing'])}\n`,
  );
});

test('delegates cleanup to namu delete with the branch as a single argument', async () => {
  const f = await fixture();
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).toBe(0);
  expect(await f.readCalls()).toBe(`${JSON.stringify(['namu', 'delete', 'feature/cards'])}\n`);
});

test('installs missing namu before cleanup too', async () => {
  const f = await fixture();
  await fs.unlink(path.join(f.bin, 'namu'));
  const result = f.run(['cleanup-worktree', 'feature/cards']);

  expect(result.status).toBe(0);
  expect(await f.readCalls()).toBe(
    `${JSON.stringify(['brew', 'install', 'kamaal111/tap/namu'])}\n${JSON.stringify(['namu', 'delete', 'feature/cards'])}\n`,
  );
});

test('explains missing Homebrew without attempting creation', async () => {
  const f = await fixture();
  await fs.unlink(path.join(f.bin, 'namu'));
  await fs.unlink(path.join(f.bin, 'brew'));
  const result = f.run(['create-worktree', 'feature/cards']);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('requires Homebrew');
  expect(await f.readCalls()).toBe('');
});

test.each([
  { name: 'failed installation', env: { BREW_EXIT: '7' }, message: 'Could not install namu' },
  { name: 'missing installed executable', env: { BREW_INSTALL: 'false' }, message: 'namu is still unavailable' },
])('stops before creation after $name', async ({ env, message }) => {
  const f = await fixture();
  await fs.unlink(path.join(f.bin, 'namu'));
  const result = f.run(['create-worktree', 'feature/cards'], env);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(await f.readCalls()).toBe(`${JSON.stringify(['brew', 'install', 'kamaal111/tap/namu'])}\n`);
});

test.each(['create-worktree', 'cleanup-worktree'])(
  'preserves namu failure status and diagnostics for %s',
  async recipe => {
    const f = await fixture();
    const result = f.run([recipe, 'feature/cards'], { NAMU_EXIT: '7' });

    expect(result.status).toBe(7);
    expect(result.stderr).toContain('namu diagnostic');
    expect(result.stdout).toBe('checkout path\n');
  },
);
