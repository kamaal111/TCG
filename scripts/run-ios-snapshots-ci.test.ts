import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const supervisor = path.resolve('scripts/run-ios-snapshots-ci.ts');

const fixtures: string[] = [];

const processes: childProcess.ChildProcess[] = [];

function fixture(mode = 'success'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-ios-cancellation-'));
  fixtures.push(directory);
  fs.writeFileSync(path.join(directory, 'mode'), mode);
  fs.writeFileSync(
    path.join(directory, 'worker.mjs'),
    `import fs from 'node:fs';
fs.writeFileSync(process.env.FIXTURE + '/worker.pid', String(process.pid));
if (process.env.MODE !== 'graceful') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
}
console.log('worker ready');
setInterval(() => {}, 1000);
`,
  );
  fs.writeFileSync(
    path.join(directory, 'just'),
    `#!${process.execPath}
import childProcess from 'node:child_process';
import fs from 'node:fs';
if (process.argv[2] === 'build-snapshots-ios') {
  fs.writeFileSync(process.env.FIXTURE + '/build.json', JSON.stringify(process.argv.slice(2)));
  console.log('build completed');
  process.exit(process.env.MODE === 'build-failure' ? 66 : 0);
}
fs.writeFileSync(process.env.FIXTURE + '/just.pid', String(process.pid));
fs.writeFileSync(process.env.FIXTURE + '/args.json', JSON.stringify(process.argv.slice(2)));
console.log('test output');
if (process.env.MODE === 'success') process.exit(0);
if (process.env.MODE === 'failure') process.exit(65);
const worker = childProcess.spawn(process.execPath, [process.env.FIXTURE + '/worker.mjs'], { stdio: 'inherit' });
if (process.env.MODE !== 'graceful') {
  process.on('SIGINT', () => {
    console.log('just received SIGINT');
    if (process.env.MODE === 'parent-exit') process.exit(0);
  });
  process.on('SIGTERM', () => {});
}
setInterval(() => {}, 1000);
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(directory, 'xcrun'),
    `#!${process.execPath}
import fs from 'node:fs';
if (process.argv[3] === 'bootstatus') {
  fs.writeFileSync(process.env.FIXTURE + '/boot.pid', String(process.pid));
  fs.writeFileSync(process.env.FIXTURE + '/boot.json', JSON.stringify(process.argv.slice(2)));
  console.log('boot ready');
  if (process.env.MODE === 'boot-failure') process.exit(9);
  if (process.env.MODE !== 'boot-hang') process.exit(0);
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  setInterval(() => console.log('boot progress'), 100);
} else {
fs.writeFileSync(process.env.FIXTURE + '/shutdown.pid', String(process.pid));
fs.writeFileSync(process.env.FIXTURE + '/shutdown.json', JSON.stringify(process.argv.slice(2)));
console.log('shutdown ready');
if (process.env.MODE === 'shutdown-failure') process.exit(7);
if (process.env.MODE !== 'shutdown-hang') process.exit(0);
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
}
`,
    { mode: 0o755 },
  );

  return directory;
}

interface StartOptions {
  directory: string;
  args?: string[];
  githubActions?: string;
  idleTimeoutSeconds?: string;
  simulator?: string;
}

function start({
  directory,
  args = [],
  githubActions = 'true',
  idleTimeoutSeconds = '180',
  simulator = '',
}: StartOptions) {
  const child = childProcess.spawn(process.execPath, [supervisor, ...args], {
    env: {
      ...process.env,
      PATH: directory,
      FIXTURE: directory,
      MODE: fs.readFileSync(path.join(directory, 'mode'), 'utf8'),
      GITHUB_ACTIONS: githubActions,
      TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS: idleTimeoutSeconds,
      TCG_IOS_SNAPSHOT_SIMULATOR: simulator,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes.push(child);
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });

  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });

  return { child, exited, output: () => output };
}

function running(pid: number): boolean {
  try {
    return !childProcess
      .execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
      .trim()
      .startsWith('Z');
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 1) {
      return false;
    }

    throw error;
  }
}

function pid(directory: string, name: string): number {
  return Number(fs.readFileSync(path.join(directory, `${name}.pid`), 'utf8'));
}

afterEach(() => {
  for (const child of processes.splice(0)) {
    child.kill('SIGKILL');
  }

  for (const directory of fixtures.splice(0)) {
    for (const name of ['just', 'worker', 'shutdown', 'boot']) {
      if (fs.existsSync(path.join(directory, `${name}.pid`))) {
        try {
          process.kill(pid(directory, name), 'SIGKILL');
        } catch {
          // The supervisor normally already stopped and reaped these processes.
        }
      }
    }

    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('iOS snapshot CI supervisor', () => {
  it('builds first, waits for simulator boot, then tests without rebuilding', async () => {
    const directory = fixture();
    const run = start({ directory, simulator: 'iPhone 17', args: ['-jobs', '2', '-resultBundlePath', '/tmp/results'] });

    expect(await run.exited).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'boot.json'), 'utf8'))).toEqual([
      'simctl',
      'bootstatus',
      'iPhone 17',
      '-b',
    ]);
    expect(run.output().indexOf('boot ready')).toBeLessThan(run.output().indexOf('test output'));
    expect(run.output().indexOf('build completed')).toBeLessThan(run.output().indexOf('boot ready'));
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'build.json'), 'utf8'))).toEqual([
      'build-snapshots-ios',
      '-jobs',
      '2',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'args.json'), 'utf8'))).toEqual([
      'test-built-snapshots-ios',
      '-jobs',
      '2',
      '-resultBundlePath',
      '/tmp/results',
    ]);
    expect(run.output()).toContain('Simulator boot completed');
  });

  it('preserves build failure without booting the simulator', async () => {
    const directory = fixture('build-failure');
    const run = start({ directory, simulator: 'iPhone 17' });

    expect(await run.exited).toBe(66);
    expect(fs.existsSync(path.join(directory, 'boot.pid'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
  });

  it('preserves boot failure and skips tests', async () => {
    const directory = fixture('boot-failure');
    const run = start({ directory, simulator: 'iPhone 17' });

    expect(await run.exited).toBe(9);
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'shutdown.json'))).toBe(true);
  });

  it('bounds boot even when the simulator keeps reporting progress', async () => {
    const directory = fixture('boot-hang');
    const run = start({ directory, simulator: 'iPhone 17', idleTimeoutSeconds: '1' });

    expect(await run.exited).toBe(124);
    expect(run.output()).toContain('Simulator boot exceeded 1 seconds');
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'boot'))).toBe(false));
  });

  it('cancels simulator boot without starting tests', async () => {
    const directory = fixture('boot-hang');
    const run = start({ directory, simulator: 'iPhone 17' });
    await vi.waitFor(() => expect(run.output()).toContain('boot ready'));
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'boot'))).toBe(false));
  });

  it('fails silent signal-resistant processes with exit 124 and kills their descendants', async () => {
    const directory = fixture('stubborn');
    const run = start({ directory, idleTimeoutSeconds: '1' });

    expect(await run.exited).toBe(124);
    expect(run.output()).toContain('No build or test output for 1 seconds');
    expect(running(pid(directory, 'just'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
    expect(fs.existsSync(path.join(directory, 'shutdown.json'))).toBe(true);
  });

  it.each(['stdout', 'stderr'])('extends the idle deadline when %s reports progress', async stream => {
    const directory = fixture();
    fs.writeFileSync(
      path.join(directory, 'just'),
      `#!${process.execPath}\nconst progress = setInterval(() => process.${stream}.write('progress\\n'), 200);\nsetTimeout(() => { clearInterval(progress); process.exit(0); }, 2200);\n`,
      { mode: 0o755 },
    );
    const run = start({ directory, idleTimeoutSeconds: '1' });

    expect(await run.exited).toBe(0);
    expect(run.output()).toContain('progress');
    expect(run.output()).not.toContain('failing stalled');
  });

  it.each(['0', '-1', 'invalid', '1.5'])('rejects invalid idle timeout %s before launching tests', async value => {
    const directory = fixture();
    const run = start({ directory, idleTimeoutSeconds: value });

    expect(await run.exited).toBe(1);
    expect(run.output()).toContain('must be a positive integer');
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
  });

  it('forwards arguments and output and shuts down simulators after success', async () => {
    const directory = fixture();
    const run = start({ directory, args: ['-resultBundlePath', '/tmp/results with spaces.xcresult'] });

    expect(await run.exited).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'args.json'), 'utf8'))).toEqual([
      'test-snapshots-ios',
      '-resultBundlePath',
      '/tmp/results with spaces.xcresult',
    ]);
    expect(run.output()).toContain('test output');
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'shutdown.json'), 'utf8'))).toEqual([
      'simctl',
      'shutdown',
      'all',
    ]);
  });

  it('preserves test failure exit 65', async () => {
    const run = start({ directory: fixture('failure') });

    expect(await run.exited).toBe(65);
  });

  it('rejects non-CI invocation before launching tests or simulator shutdown', async () => {
    const directory = fixture();
    const run = start({ directory, githubActions: '' });

    expect(await run.exited).toBe(1);
    expect(run.output()).toContain('GitHub Actions');
    expect(fs.existsSync(path.join(directory, 'just.pid'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'shutdown.pid'))).toBe(false);
  });

  it('forwards SIGINT to the child and grandchild and exits 130', async () => {
    const directory = fixture('graceful');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    run.child.kill('SIGINT');

    expect(await run.exited).toBe(130);
    expect(running(pid(directory, 'just'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
    expect(run.output()).toContain('Cleanup complete');
  });

  it('kills signal-resistant children within the cleanup budget', async () => {
    const directory = fixture('stubborn');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    const started = performance.now();
    run.child.kill('SIGINT');

    expect(await run.exited).toBe(130);
    expect(performance.now() - started).toBeLessThan(6000);
    expect(run.output()).toContain('SIGKILL');
    expect(running(pid(directory, 'just'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
  }, 10000);

  it('kills a grandchild even when its parent exits on SIGINT', async () => {
    const directory = fixture('parent-exit');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    run.child.kill('SIGINT');

    expect(await run.exited).toBe(130);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
  });

  it('escalates SIGTERM immediately and exits 143', async () => {
    const directory = fixture('stubborn');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    expect(running(pid(directory, 'just'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
  });

  it('escalates a repeated cancellation immediately', async () => {
    const directory = fixture('stubborn');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    run.child.kill('SIGINT');
    await vi.waitFor(() => expect(run.output()).toContain('just received SIGINT'));
    run.child.kill('SIGINT');

    expect(await run.exited).toBe(130);
    expect(running(pid(directory, 'just'))).toBe(false);
    await vi.waitFor(() => expect(running(pid(directory, 'worker'))).toBe(false));
  });

  it('bounds a hanging simulator shutdown without changing a successful result', async () => {
    const directory = fixture('shutdown-hang');
    fs.rmSync(path.join(directory, 'just'));
    fs.writeFileSync(path.join(directory, 'just'), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
    const started = performance.now();
    const run = start({ directory });

    expect(await run.exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(6000);
    expect(run.output()).toContain('shutdown timed out');
    await vi.waitFor(() => expect(running(pid(directory, 'shutdown'))).toBe(false));
  }, 10000);

  it('handles cancellation during simulator shutdown without waiting for its deadline', async () => {
    const directory = fixture('shutdown-hang');
    fs.writeFileSync(path.join(directory, 'just'), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('shutdown ready'));
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    await vi.waitFor(() => expect(running(pid(directory, 'shutdown'))).toBe(false));
  });

  it('warns on simulator shutdown failure while preserving success', async () => {
    const directory = fixture('shutdown-failure');
    fs.writeFileSync(path.join(directory, 'just'), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
    const run = start({ directory });

    expect(await run.exited).toBe(0);
    expect(run.output()).toContain('shutdown exited with code 7');
  });

  it('reports test spawn failure and still completes cleanup', async () => {
    const directory = fixture();
    fs.rmSync(path.join(directory, 'just'));
    const run = start({ directory });

    expect(await run.exited).toBe(1);
    expect(run.output()).toContain('Could not launch iOS snapshots');
    expect(fs.existsSync(path.join(directory, 'shutdown.json'))).toBe(true);
  });

  it('warns on shutdown spawn failure while preserving the test result', async () => {
    const directory = fixture('failure');
    fs.rmSync(path.join(directory, 'xcrun'));
    const run = start({ directory });

    expect(await run.exited).toBe(65);
    expect(run.output()).toContain('Could not launch simulator shutdown');
  });

  it('leaves unrelated processes alive when cancelling the test group', async () => {
    const unrelated = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    processes.push(unrelated);
    const directory = fixture('stubborn');
    const run = start({ directory });
    await vi.waitFor(() => expect(run.output()).toContain('worker ready'));
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    expect(unrelated.kill(0)).toBe(true);
  });
});
