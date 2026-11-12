import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import z from 'zod';

import { appFingerprint } from './app-release/config.ts';
import { runAppRelease } from './app-release/runtime.ts';
import type { Prompts } from './infra/prompts.ts';
import { waitForProcessOutput } from './process-test-utils.ts';
import { acquireLocalLease } from './release/lock.ts';
import { inspectApp } from '../devportal/src/inspection.ts';

const execute = util.promisify(childProcess.execFile);
const repository = url.fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repository, 'scripts/app-release.sh');
const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shell app release-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const config = path.join(directory, 'private config');
  const bin = path.join(directory, 'bin');
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'app/Configuration'), { recursive: true });
  await fs.mkdir(config);
  await fs.mkdir(bin);
  await fs.copyFile(script, path.join(root, 'scripts/app-release.sh'));
  await fs.copyFile(
    path.join(repository, 'scripts/run-with-xcbeautify.sh'),
    path.join(root, 'scripts/run-with-xcbeautify.sh'),
  );
  await fs.writeFile(
    path.join(bin, 'xcbeautify'),
    `#!${process.execPath}\nprocess.stdin.on('data', data => process.stdout.write('pretty: ' + data));`,
    { mode: 0o755 },
  );
  await fs.writeFile(path.join(root, 'app/Configuration/App.xcconfig'), 'MARKETING_VERSION = 1.0\n');
  const git = (args: string[]) => execute('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.invalid']);
  await git(['add', '.']);
  await git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Fixture']);
  await git(['remote', 'add', 'origin', root]);
  const sha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await fs.writeFile(path.join(config, 'app-release.json'), JSON.stringify(settings), { mode: 0o600 });
  await fs.writeFile(
    path.join(config, 'app-store-connect.json'),
    JSON.stringify({ email: 'release@example.invalid', password: 'test-test-test-test' }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(bin, 'ioreg'),
    `#!${process.execPath}
const fs=require('node:fs');
const locked=process.env.TCG_TEST_SCREEN_LOCK && fs.readFileSync(process.env.TCG_TEST_SCREEN_LOCK,'utf8').trim()==='locked';
console.log('<plist version="1.0"><dict><key>IOConsoleLocked</key><'+(locked?'true':'false')+'/></dict></plist>');`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'stat'),
    '#!/bin/bash\nif [[ "$*" == "-f %u /dev/console" ]]; then echo ' +
      os.userInfo().uid +
      '; else exec /usr/bin/stat "$@"; fi\n',
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'caffeinate'),
    `#!${process.execPath}
require('node:fs').writeFileSync(process.env.TCG_TEST_AWAKE, JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));
setInterval(()=>{try{process.kill(Number(process.argv.at(-1)),0);}catch{process.exit(0);}},100);`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'pmset'),
    '#!/bin/bash\nif [[ -r "$TCG_TEST_AWAKE" ]]; then pid="$(/usr/bin/plutil -extract pid raw -o - "$TCG_TEST_AWAKE")"; printf "pid %s(caffeinate): PreventUserIdleDisplaySleep\\npid %s(caffeinate): PreventUserIdleSystemSleep\\n" "$pid" "$pid"; fi\n',
    { mode: 0o755 },
  );
  const calls = path.join(directory, 'calls.jsonl');
  await fs.writeFile(calls, '');
  await fs.writeFile(
    path.join(bin, 'xcodebuild'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TCG_TEST_CALLS, JSON.stringify(args)+'\\n');
if (process.env.TCG_TEST_STALL) {
 const worker=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
 fs.writeFileSync(process.env.TCG_TEST_STALL, JSON.stringify([process.pid, worker.pid]));
 console.log('Compiler fixture ready');
 setInterval(()=>{},1000);
} else if (args.includes('archive')) {
 const archive=args[args.indexOf('-archivePath')+1];
 const mac=args.includes('generic/platform=macOS');
 const app=path.join(archive, 'Products/Applications/Mintomo.app');
 const info=path.join(app, mac?'Contents/Info.plist':'Info.plist');
 fs.mkdirSync(path.dirname(info), {recursive:true});
 fs.writeFileSync(path.join(archive,'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CreationDate</key><date>2026-01-02T03:04:05Z</date><key>ApplicationProperties</key><dict><key>ApplicationPath</key><string>Applications/Mintomo.app</string><key>CFBundleShortVersionString</key><string>1.0</string></dict></dict></plist>');
 fs.writeFileSync(info, JSON.stringify({CFBundleIdentifier:'io.kamaal.TCG',CFBundleShortVersionString:'1.0',CFBundleSupportedPlatforms:[mac?'MacOSX':'iPhoneOS'],TCGAPIBaseURL:'https://api.mintomo.com',TCGAPIEnvironment:'remote'}));
 if(process.env.TCG_TEST_LOCK_AFTER_ARCHIVE){fs.writeFileSync(process.env.TCG_TEST_SCREEN_LOCK,'locked');}
 console.log('Archive fixture completed');
} else if (process.env.TCG_TEST_ACCOUNT_FAILURE) {
 console.error('error: exportArchive Failed to Use Accounts'); process.exitCode=70;
} else {
 const dest=args[args.indexOf('-exportPath')+1];
 const archive=args[args.indexOf('-archivePath')+1];
 fs.mkdirSync(dest,{recursive:true});
 const mac=fs.existsSync(path.join(archive,'Products/Applications/Mintomo.app/Contents/Info.plist'));
 fs.writeFileSync(path.join(dest,mac?'Mintomo.pkg':'Mintomo.ipa'),'fixture package');
 console.log('Export fixture completed');
}
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'xcrun'),
    `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.TCG_TEST_CALLS,JSON.stringify(args)+'\\n');
const email=args[args.indexOf('-u')+1];
console.log('Upload fixture completed '+email+' '+process.env.TCG_APP_STORE_PASSWORD);
if(process.env.TCG_TEST_UPLOAD_FAILURE){console.error('Upload credentials rejected '+email+' '+process.env.TCG_APP_STORE_PASSWORD);process.exitCode=70;}
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'codesign'),
    '#!/bin/bash\nset -e\nif [[ "$2" == -R ]]; then csreq -r "$3" -b /dev/null; fi\n',
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TCG_TEST_CALLS: calls,
    TCG_TEST_AWAKE: path.join(directory, 'awake.json'),
  };

  const invoke = (mode: string, platform: string, args: string[] = [], extra: Record<string, string> = {}) => {
    return execute(
      'bash',
      [path.join(root, 'scripts/app-release.sh'), mode, platform, ...args, '--config-dir', config],
      {
        cwd: root,
        env: { ...env, ...extra },
      },
    );
  };

  const records = async () => {
    return (await fs.readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => z.array(z.string()).parse(JSON.parse(line)));
  };

  const summary = async () => {
    const sessions = await fs.readdir(path.join(config, 'app-releases'));

    return JSON.parse(await fs.readFile(path.join(config, 'app-releases', sessions[0] ?? '', 'summary.json'), 'utf8'));
  };

  return { root, config, env, sha, calls, invoke, records, summary, directory };
}

test.each(['setup-app-release', 'release-ios', 'release-macos', 'archive-ios', 'archive-macos', 'logs-app-release'])(
  '%s explains usage without Apple credentials',
  recipe => {
    const result = childProcess.spawnSync('just', [recipe, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('$HOME/.config/tcg');
    expect(result.stdout).toContain('origin/main');
  },
);

describe.runIf(process.platform === 'darwin')('native shell release pipeline', () => {
  test.each([
    { platform: 'ios', destination: 'generic/platform=iOS' },
    { platform: 'macos', destination: 'generic/platform=macOS' },
  ] as const)(
    'releases $platform with local export followed by private-credential upload',
    async ({ platform, destination }) => {
      const f = await fixture();
      const result = await f.invoke('release', platform);
      expect(result.stdout).toContain('Uploaded to App Store Connect; processing pending.');
      expect(result.stdout).not.toContain('Approve');
      expect(result.stdout).toContain('archive → sign → inspect → export → upload');
      expect(result.stdout).toContain('Upload: separate Apple CLI with private credentials');
      const calls = await f.records();
      expect(calls).toHaveLength(3);
      expect(calls[0]).toContain(destination);
      expect(calls[0]).toContain('-allowProvisioningUpdates');
      expect(calls[0]).not.toContain('-authenticationKeyPath');
      expect(calls[1]).toContain('-allowProvisioningUpdates');
      expect(calls[1]).not.toContain('-authenticationKeyID');
      expect(calls.flat()).not.toContain('test');
      expect(await f.summary()).toMatchObject({
        platform,
        state: 'uploaded',
        fingerprint: appFingerprint(platform, f.sha, settings),
      });
      await expect(fs.access(path.join(f.config, 'app-release.lock'))).rejects.toThrow('ENOENT');
      await expect(f.invoke('release', platform)).rejects.toMatchObject({
        stderr: expect.stringContaining('already uploaded'),
      });
    },
  );

  test('formats Xcode output while keeping private logs raw', async () => {
    const f = await fixture();
    const result = await f.invoke('release', 'ios');
    expect(result.stdout).toContain('pretty: Archive fixture completed');
    expect(result.stdout).toContain('pretty: Export fixture completed');
    expect(result.stdout).toContain('Upload fixture completed [private email] [private password]');
    expect(result.stdout).not.toContain('release@example.invalid');
    expect(result.stdout).not.toContain('test-test-test-test');
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const log = await fs.readFile(path.join(f.config, 'app-releases', sessions[0] ?? '', 'release.log'), 'utf8');
    expect(log).toContain('Archive fixture completed');
    expect(log).not.toContain('pretty:');
    expect(log).not.toContain('release@example.invalid');
    expect(log).not.toContain('test-test-test-test');
  });

  test('raw-output override bypasses formatting', async () => {
    const f = await fixture();
    const result = await f.invoke('release', 'ios', [], { TCG_XCODE_RAW_OUTPUT: '1' });
    expect(result.stdout).toContain('Archive fixture completed');
    expect(result.stdout).not.toContain('pretty:');
  });

  test.each([0, 7])('a formatter that exits early with %s cannot stop or fail an upload', async code => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, 'bin/xcbeautify'), `#!${process.execPath}\nprocess.exit(${code});`, {
      mode: 0o755,
    });
    const result = await f.invoke('release', 'ios');
    expect(result.stdout).toContain('Uploaded to App Store Connect; processing pending.');
    expect(await f.records()).toHaveLength(3);
    expect(await f.summary()).toMatchObject({ state: 'uploaded' });
  });

  test('raw Apple errors stay visible with their exit code even when formatting hides them', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, 'bin/xcbeautify'), `#!${process.execPath}\nprocess.stdin.resume();`, {
      mode: 0o755,
    });
    await expect(f.invoke('release', 'ios', [], { TCG_TEST_ACCOUNT_FAILURE: '1' })).rejects.toMatchObject({
      code: 70,
      stdout: expect.stringContaining('error: exportArchive Failed to Use Accounts'),
    });
    expect(await f.summary()).toMatchObject({ state: 'failed' });
  });

  test('waits for unlock before signing and releases its temporary awake assertion', async () => {
    const f = await fixture();
    const lock = path.join(f.directory, 'screen-lock');
    await fs.writeFile(lock, 'locked');

    const child = childProcess.spawn(
      'bash',
      [path.join(f.root, 'scripts/app-release.sh'), 'archive', 'ios', '--config-dir', f.config],
      { env: { ...f.env, TCG_TEST_SCREEN_LOCK: lock } },
    );

    const closed = new Promise(resolve => child.once('close', resolve));
    onTestFinished(async () => {
      child.kill('SIGTERM');
      await closed;
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    await waitForProcessOutput(child, 'Waiting for the release Mac to be unlocked');
    expect(await f.records()).toEqual([]);
    await fs.writeFile(lock, 'unlocked');
    expect(await closed).toBe(0);
    expect(output).toContain('Release Mac unlocked; continuing signing.');
    expect(await f.records()).toHaveLength(1);

    const awake = z
      .object({ pid: z.number(), args: z.array(z.string()) })
      .parse(JSON.parse(await fs.readFile(path.join(f.directory, 'awake.json'), 'utf8')));

    expect(awake.args).toEqual(['-di', '-w', String(child.pid)]);
    expect(() => process.kill(awake.pid, 0)).toThrow('ESRCH');
  }, 10000);

  test('checks the lock again before exporting a completed archive', async () => {
    const f = await fixture();
    const lock = path.join(f.directory, 'screen-lock');
    await fs.writeFile(lock, 'unlocked');

    const child = childProcess.spawn(
      'bash',
      [path.join(f.root, 'scripts/app-release.sh'), 'release', 'ios', '--config-dir', f.config],
      { env: { ...f.env, TCG_TEST_SCREEN_LOCK: lock, TCG_TEST_LOCK_AFTER_ARCHIVE: '1' } },
    );

    const closed = new Promise(resolve => child.once('close', resolve));
    onTestFinished(async () => {
      child.kill('SIGTERM');
      await closed;
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    await waitForProcessOutput(child, 'Waiting for the release Mac to be unlocked');
    expect(await f.records()).toHaveLength(1);
    await fs.writeFile(lock, 'unlocked');
    expect(await closed).toBe(0);
    expect(await f.records()).toHaveLength(3);
  }, 10000);

  test('a failed awake assertion stops before any signing command', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, 'bin/caffeinate'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    await expect(f.invoke('archive', 'ios')).rejects.toMatchObject({
      stderr: expect.stringContaining('The temporary awake assertion failed. No signing command was started.'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('unknown lock state stops before signing', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, 'bin/ioreg'), '#!/bin/bash\nprintf invalid-plist\n', { mode: 0o755 });
    await expect(f.invoke('archive', 'ios')).rejects.toMatchObject({
      stderr: expect.stringContaining('Cannot check the release Mac lock state'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('archive-only uses Xcode automatic signing without API credentials or upload', async () => {
    const f = await fixture();
    const result = await f.invoke('archive', 'ios');
    expect(result.stdout).toContain('Archive ready:');
    expect(await f.records()).toHaveLength(1);
    expect((await f.records())[0]).toContain('-allowProvisioningUpdates');
  });

  test('cancellation stops the compiler tree and releases the lease', async () => {
    const f = await fixture();
    const pids = path.join(f.directory, 'worker-pids.json');

    const child = childProcess.spawn(
      'bash',
      [path.join(f.root, 'scripts/app-release.sh'), 'release', 'ios', '--config-dir', f.config],
      {
        env: { ...f.env, TCG_TEST_STALL: pids },
      },
    );

    const closed = new Promise(resolve => child.once('close', resolve));
    onTestFinished(async () => {
      child.kill('SIGTERM');
      await closed;
    });
    await waitForProcessOutput(child, 'Compiler fixture ready');
    expect(await fs.readFile(path.join(f.config, 'app-release.lock/pid'), 'utf8')).toBe(String(child.pid));
    const workers = z.array(z.number().int().positive()).parse(JSON.parse(await fs.readFile(pids, 'utf8')));
    child.kill('SIGTERM');
    expect(await closed).toBe(143);
    await vi.waitFor(() => {
      for (const pid of workers) {
        expect(() => process.kill(pid, 0)).toThrow('ESRCH');
      }
    });
    await expect(fs.access(path.join(f.config, 'app-release.lock'))).rejects.toThrow('ENOENT');
    expect(await f.summary()).toMatchObject({ state: 'failed' });
  });

  test('a silent compiler reports its milestone and stops with an idle timeout', async () => {
    const f = await fixture();
    const bin = path.join(f.directory, 'bin');
    await fs.writeFile(
      path.join(bin, 'date'),
      '#!/bin/bash\nif [[ "$1" == +%s ]]; then echo "$(( $(/bin/date +%s) + 601 ))"; else exec /bin/date "$@"; fi\n',
      { mode: 0o755 },
    );
    await expect(
      f.invoke('release', 'ios', [], { TCG_TEST_STALL: path.join(f.directory, 'idle-workers.json') }),
    ).rejects.toMatchObject({
      code: 124,
      stdout: expect.stringContaining('Archive and sign ios:'),
    });
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const log = await fs.readFile(path.join(f.config, 'app-releases', sessions[0] ?? '', 'release.log'), 'utf8');
    expect(log).toContain('Stopping command after ten minutes without tool output.');
    expect(log).toContain('Stopped: Archive and sign ios (exit 124)');
    expect(await f.records()).toHaveLength(1);
    await expect(fs.access(path.join(f.config, 'app-release.lock'))).rejects.toThrow('ENOENT');
  }, 45000);

  test('log viewer follows the newest selected platform log and leaves the release lease alone', async () => {
    const f = await fixture();
    const ios = path.join(f.config, 'app-releases/ios-first/release.log');
    const mac = path.join(f.config, 'app-releases/macos-latest/release.log');
    await fs.mkdir(path.dirname(ios), { recursive: true });
    await fs.mkdir(path.dirname(mac), { recursive: true });
    await fs.writeFile(ios, 'iOS archive started\n');
    await fs.utimes(ios, new Date(0), new Date(0));
    await fs.writeFile(mac, 'macOS log\n');
    const lease = await acquireLocalLease(f.config, 'app-release');
    onTestFinished(lease);
    const viewer = childProcess.spawn('bash', [script, 'logs', '', 'ios', '--config-dir', f.config]);
    const closed = new Promise(resolve => viewer.once('close', resolve));
    onTestFinished(() => {
      viewer.kill('SIGTERM');
    });
    let output = '';
    viewer.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    await vi.waitFor(() => expect(output).toContain('iOS archive started'));
    await fs.appendFile(ios, 'iOS upload finished\n');
    await vi.waitFor(() => expect(output).toContain('iOS upload finished'));
    expect(output).not.toContain('macOS log');
    viewer.kill('SIGTERM');
    await closed;
    expect(await fs.readFile(path.join(f.config, 'app-release.lock/pid'), 'utf8')).toBe(String(process.pid));
  });

  test('exports locally and uploads the package with an environment password reference', async () => {
    const f = await fixture();
    await f.invoke('release', 'ios');
    const calls = await f.records();
    expect(calls[2]).toContain('altool');
    expect(calls[2]).toContain('--upload-app');
    expect(calls[2]).toContain('@env:TCG_APP_STORE_PASSWORD');
    expect(calls.flat()).not.toContain('test-test-test-test');
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const options = path.join(f.config, 'app-releases', sessions[0] ?? '', 'ExportOptions.plist');
    const destination = await execute('plutil', ['-extract', 'destination', 'raw', '-o', '-', options]);
    expect(destination.stdout.trim()).toBe('export');
  });

  test('missing private upload settings stop before any Apple command', async () => {
    const f = await fixture();
    await fs.rm(path.join(f.config, 'app-store-connect.json'));
    await expect(f.invoke('release', 'ios')).rejects.toMatchObject({
      stderr: expect.stringContaining('save your App Store Connect email'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('authentication failure preserves the archive and can be retried without rebuilding', async () => {
    const f = await fixture();
    await expect(f.invoke('release', 'ios', [], { TCG_TEST_UPLOAD_FAILURE: '1' })).rejects.toMatchObject({
      code: 70,
      stdout: expect.stringContaining('Upload credentials rejected [private email] [private password]'),
    });
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const archive = path.join(f.config, 'app-releases', sessions[0] ?? '', 'Mintomo.xcarchive');
    expect(await f.summary()).toMatchObject({ state: 'failed' });
    const retried = await f.invoke('upload', 'ios', [archive]);
    expect(retried.stdout).toContain('Uploaded to App Store Connect');
    expect((await f.records()).filter(args => args.includes('archive'))).toHaveLength(1);
    expect(await f.summary()).toMatchObject({ state: 'uploaded' });
  });

  test('upload-only rejects changed release settings without modifying archive history', async () => {
    const f = await fixture();
    await f.invoke('archive', 'ios');
    const original = await f.summary();
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const archive = path.join(f.config, 'app-releases', sessions[0] ?? '', 'Mintomo.xcarchive');
    await fs.writeFile(
      path.join(f.config, 'app-release.json'),
      JSON.stringify({ ...settings, apiHost: 'other.mintomo.com' }),
    );
    await expect(f.invoke('upload', 'ios', [archive])).rejects.toMatchObject({
      stderr: expect.stringContaining('Archive settings differ'),
    });
    expect(await f.records()).toHaveLength(1);
    expect(await f.summary()).toEqual(original);
  });

  test('Devportal inspection allows release with private upload setup', async () => {
    const f = await fixture();
    const status = await inspectApp({ root: f.root, configDirectory: f.config }, 'ios', 0);
    expect(status).toMatchObject({ blocker: null, main: f.sha, fingerprint: appFingerprint('ios', f.sha, settings) });
    expect(await f.records()).toEqual([]);
  });

  test('Devportal reports a setup blocker when upload credentials are absent', async () => {
    const f = await fixture();
    await fs.rm(path.join(f.config, 'app-store-connect.json'));
    const status = await inspectApp({ root: f.root, configDirectory: f.config }, 'ios', 0);
    expect(status.blocker).toContain('Upload setup is required');
    expect(await f.records()).toEqual([]);
  });

  test('Devportal invokes the same shell pipeline under its existing lease without extra approvals', async () => {
    const f = await fixture();
    const lease = await acquireLocalLease(f.config, 'app-release');
    onTestFinished(lease);
    const note = vi.fn<Prompts['note']>();
    const confirm = vi.fn<Prompts['confirm']>();

    const prompts: Prompts = {
      note,
      confirm,
      text: vi.fn<Prompts['text']>(),
      password: vi.fn<Prompts['password']>(),
      select: vi.fn<Prompts['select']>(),
      multiselect: vi.fn<Prompts['multiselect']>(),
    };

    vi.stubEnv('PATH', f.env.PATH);
    vi.stubEnv('TCG_TEST_CALLS', f.calls);
    vi.stubEnv('TCG_TEST_AWAKE', f.env.TCG_TEST_AWAKE);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    await runAppRelease({
      root: f.root,
      configDirectory: f.config,
      platform: 'ios',
      revision: 'origin/main',
      prompts,
      reviewedFingerprint: appFingerprint('ios', f.sha, settings),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(note).toHaveBeenCalledWith(expect.stringContaining('Upload to App Store Connect'));
    expect(await f.summary()).toMatchObject({ state: 'uploaded' });
  });
});
