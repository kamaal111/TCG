import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runner = path.resolve('scripts/run-with-xcbeautify.sh');

const installer = path.resolve('scripts/install-xcbeautify.sh');

const formatterCompatibility = path.resolve('scripts/test-xcode-formatter.sh');

const hasXcbeautify =
  childProcess.spawnSync('/bin/sh', ['-c', 'command -v xcbeautify'], { stdio: 'ignore' }).status === 0;

const fixtures: string[] = [];

const processes: childProcess.ChildProcess[] = [];

function script(file: string, source: string): void {
  fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg xcbeautify-'));
  fixtures.push(directory);
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  script(path.join(bin, 'xcbeautify'), `process.stdin.on('data', data => process.stdout.write('formatted: ' + data));`);
  script(
    path.join(bin, 'brew'),
    `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(path.join(directory, 'install.json'))}, JSON.stringify(process.argv.slice(2)));
fs.copyFileSync(${JSON.stringify(path.join(directory, 'formatter'))}, ${JSON.stringify(path.join(bin, 'xcbeautify'))});`,
  );
  fs.copyFileSync(path.join(bin, 'xcbeautify'), path.join(directory, 'formatter'));

  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    GITHUB_ACTIONS: 'false',
    TCG_XCODE_RAW_OUTPUT: '',
    TCG_XCODE_LOG_DIR: path.join(directory, 'logs'),
  };

  function invoke(args: string[]) {
    return childProcess.spawnSync('/bin/bash', [runner, ...args], { env, encoding: 'utf8', timeout: 10_000 });
  }

  function install() {
    return childProcess.spawnSync('/bin/bash', [installer], { env, encoding: 'utf8', timeout: 10_000 });
  }

  return { directory, bin, env, invoke, install };
}

afterEach(() => {
  for (const child of processes.splice(0)) {
    child.kill('SIGKILL');
  }

  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('xcbeautify installation', () => {
  it('keeps an existing PATH installation without running Homebrew', () => {
    const { directory, install } = fixture();

    expect(install().status).toBe(0);
    expect(fs.existsSync(path.join(directory, 'install.json'))).toBe(false);
  });

  it('installs through Homebrew only when xcbeautify is missing', () => {
    const { directory, bin, invoke, install } = fixture();
    fs.unlinkSync(path.join(bin, 'xcbeautify'));

    expect(install().status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'install.json'), 'utf8'))).toEqual([
      'install',
      'xcbeautify',
    ]);
    fs.unlinkSync(path.join(directory, 'install.json'));
    expect(install().status).toBe(0);
    expect(fs.existsSync(path.join(directory, 'install.json'))).toBe(false);
    expect(invoke(['tests', process.execPath, '-e', "console.log('Homebrew tool')"]).stdout).toContain(
      'formatted: Homebrew tool',
    );
  });
  it('explains the Homebrew prerequisite when neither tool is installed', () => {
    const { bin, install } = fixture();
    fs.unlinkSync(path.join(bin, 'xcbeautify'));
    fs.unlinkSync(path.join(bin, 'brew'));

    const result = install();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires Homebrew');
  });
});

describe('xcbeautify runner', () => {
  it('preserves build and test output with the installed xcbeautify', { skip: !hasXcbeautify }, () => {
    const result = childProcess.spawnSync('/bin/bash', [formatterCompatibility], { encoding: 'utf8', timeout: 10_000 });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('build, Swift Testing, and XCTest visibility checks passed for both renderers');
  });

  it.each([
    ['false', 'terminal'],
    ['true', 'github-actions'],
  ])('selects the %s GitHub Actions environment renderer %s', (githubActions, renderer) => {
    const { bin, env, invoke } = fixture();
    env.GITHUB_ACTIONS = githubActions;
    script(path.join(bin, 'xcbeautify'), 'console.log(JSON.stringify(process.argv.slice(2))); process.stdin.resume();');

    const result = invoke(['tests', process.execPath, '-e', "console.log('build output')"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['--renderer', renderer]);
  });

  it('fails before starting the command when xcbeautify is missing', () => {
    const { directory, bin, invoke } = fixture();
    fs.unlinkSync(path.join(bin, 'xcbeautify'));

    const result = invoke([
      'tests',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'started'))}, '')`,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('just bootstrap');
    expect(fs.existsSync(path.join(directory, 'started'))).toBe(false);
  });

  it('formats stdout and stderr and retains both raw streams', () => {
    const { directory, invoke } = fixture();

    const result = invoke([
      'tests',
      process.execPath,
      '-e',
      "console.log('build output'); console.error('warning: sample');",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('formatted:');
    expect(result.stdout).toContain('build output');
    expect(result.stdout).toContain('warning: sample');
    expect(fs.readFileSync(path.join(directory, 'logs/tests.log'), 'utf8')).toContain('build output');
    expect(fs.readFileSync(path.join(directory, 'logs/tests.log'), 'utf8')).toContain('warning: sample');
  });

  it('preserves a failing command exit code', () => {
    const { invoke } = fixture();

    expect(invoke(['tests', process.execPath, '-e', "console.error('test failed'); process.exit(65)"]).status).toBe(65);
  });

  it.each([
    path.resolve('app/Modules/TCGFeatures/Sources/TCGCards/Views/PurchaseBatchFields.swift'),
    'Modules/TCGFeatures/Sources/TCGCards/Views/PurchaseBatchFields.swift',
    'app/Modules/TCGFeatures/Sources/TCGCards/Views/PurchaseBatchFields.swift',
    'TCG/TCGApp.swift',
  ])('rejects a successful build that emits a repository source warning at %s', source => {
    const { directory, invoke } = fixture();
    const diagnostic = `${source}:30:30: warning: converting non-Sendable function value to '@isolated(any) @Sendable (Currency) -> Void' may introduce data races`;

    const result = invoke(['tests', process.execPath, '-e', `console.error(${JSON.stringify(diagnostic)})`]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stderr).toContain('Xcode emitted warnings in repository application sources.');
    expect(fs.readFileSync(path.join(directory, 'logs/tests.log'), 'utf8')).toContain(diagnostic);
  });

  it.each([
    '/tmp/SourcePackages/checkouts/Dependency/Sources/Dependency.swift',
    path.resolve('app/Modules/TCGFeatures/.build/checkouts/Dependency/Sources/Dependency.swift'),
  ])('keeps dependency warnings at %s visible without treating them as repository source warnings', source => {
    const { invoke } = fixture();
    const diagnostic = `${source}:30:30: warning: dependency warning`;

    const result = invoke(['tests', process.execPath, '-e', `console.error(${JSON.stringify(diagnostic)})`]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(diagnostic);
  });

  it('fails when the formatter fails after consuming output', () => {
    const { bin, invoke } = fixture();
    script(path.join(bin, 'xcbeautify'), "process.stdin.resume(); process.stdin.on('end', () => process.exit(7));");

    expect(invoke(['tests', process.execPath, '-e', "console.log('test passed')"]).status).toBe(7);
  });

  it('fails when the formatter exits before a long-running command finishes', () => {
    const { bin, invoke } = fixture();
    script(path.join(bin, 'xcbeautify'), 'process.exit(0);');

    expect(invoke(['tests', process.execPath, '-e', 'setInterval(() => {}, 1000)']).status).toBe(143);
  });

  it('fails before starting the command when the raw log cannot be opened', () => {
    const { directory, invoke } = fixture();
    fs.writeFileSync(path.join(directory, 'logs'), 'not a directory');

    const result = invoke([
      'tests',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'started'))}, '')`,
    ]);

    expect(result.status).toBe(1);
    expect(fs.existsSync(path.join(directory, 'started'))).toBe(false);
  });

  it('formats nested commands once while preserving arguments with spaces', () => {
    const { invoke } = fixture();

    const result = invoke([
      'outer',
      '/bin/bash',
      runner,
      'inner',
      process.execPath,
      '-e',
      'console.log(process.argv[1])',
      'argument with spaces',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('formatted: argument with spaces\n');
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('cancels the command process group on %s', async (signal, exitCode) => {
    const { directory, env } = fixture();
    const pidFile = path.join(directory, 'worker.pid');
    const worker = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const command = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;

    const child = childProcess.spawn('/bin/bash', [runner, 'tests', process.execPath, '-e', command], {
      env,
      stdio: 'ignore',
    });

    processes.push(child);
    const exited = new Promise<number | null>(resolve => child.once('close', resolve));
    await expect.poll(() => fs.existsSync(pidFile)).toBe(true);
    child.kill(signal);

    expect(await exited).toBe(exitCode);
    const workerPid = fs.readFileSync(pidFile, 'utf8');
    await expect
      .poll(() =>
        childProcess.spawnSync('/bin/ps', ['-p', workerPid, '-o', 'stat='], { encoding: 'utf8' }).stdout.trim(),
      )
      .toBe('');
  });
});
