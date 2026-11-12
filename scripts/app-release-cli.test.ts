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
import { acquireLocalLease } from './release/lock.ts';
import { inspectApp } from '../devportal/src/inspection.ts';

const execute = util.promisify(childProcess.execFile);
const repository = url.fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repository, 'scripts/app-release.sh');
const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

async function fixture(apiKey = false) {
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
  const keyPath = path.join(config, 'AuthKey_ABCDEF1234.p8');
  await fs.writeFile(keyPath, 'fixture-private-key', { mode: 0o600 });

  if (apiKey) {
    await fs.writeFile(
      path.join(config, 'app-store-connect.json'),
      JSON.stringify({ keyPath, keyID: 'ABCDEF1234', issuerID: '12345678-1234-4234-9234-123456789012' }),
      { mode: 0o600 },
    );
  }

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
 setInterval(()=>{},1000);
} else if (args.includes('archive')) {
 const archive=args[args.indexOf('-archivePath')+1];
 const mac=args.includes('generic/platform=macOS');
 const app=path.join(archive, 'Products/Applications/Mintomo.app');
 const info=path.join(app, mac?'Contents/Info.plist':'Info.plist');
 fs.mkdirSync(path.dirname(info), {recursive:true});
 fs.writeFileSync(path.join(archive,'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CreationDate</key><date>2026-01-02T03:04:05Z</date><key>ApplicationProperties</key><dict><key>ApplicationPath</key><string>Applications/Mintomo.app</string><key>CFBundleShortVersionString</key><string>1.0</string></dict></dict></plist>');
 fs.writeFileSync(info, JSON.stringify({CFBundleIdentifier:'io.kamaal.TCG',CFBundleShortVersionString:'1.0',CFBundleSupportedPlatforms:[mac?'MacOSX':'iPhoneOS'],TCGAPIBaseURL:'https://api.mintomo.com',TCGAPIEnvironment:'remote'}));
 console.log('Archive fixture completed');
} else if (process.env.TCG_TEST_ACCOUNT_FAILURE) {
 console.error('error: exportArchive Failed to Use Accounts'); process.exitCode=70;
} else { console.log('Upload fixture completed'); }
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, 'codesign'),
    '#!/bin/bash\nset -e\nif [[ "$2" == -R ]]; then csreq -r "$3" -b /dev/null; fi\n',
    { mode: 0o755 },
  );
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TCG_TEST_CALLS: calls };

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
    'releases $platform without stdin questions using the Xcode account',
    async ({ platform, destination }) => {
      const f = await fixture();
      const result = await f.invoke('release', platform);
      expect(result.stdout).toContain('Uploaded to App Store Connect; processing pending.');
      expect(result.stdout).not.toContain('Approve');
      expect(result.stdout).toContain('archive → sign → inspect → upload');
      expect(result.stdout).toContain('Authentication: Xcode account');
      const calls = await f.records();
      expect(calls).toHaveLength(2);
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
        stdio: 'ignore',
      },
    );

    const closed = new Promise(resolve => child.once('close', resolve));
    onTestFinished(() => {
      child.kill('SIGTERM');
    });
    await vi.waitFor(() => expect(fs.access(pids)).resolves.toBeUndefined());
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

  test('uses explicitly configured API credentials for both archive and upload', async () => {
    const f = await fixture(true);
    await f.invoke('release', 'ios');
    const calls = await f.records();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('-authenticationKeyPath');
    expect(calls[1]).toContain('-authenticationKeyID');
    expect(calls[1]).toContain('-authenticationKeyIssuerID');
  });

  test('invalid optional API credentials stop before any xcodebuild call', async () => {
    const f = await fixture(true);
    await fs.writeFile(
      path.join(f.config, 'app-store-connect.json'),
      JSON.stringify({
        keyPath: path.join(f.config, 'AuthKey_ABCDEF1234.p8'),
        keyID: 'ABCDEF1234',
        issuerID: 'invalid',
      }),
    );
    await expect(f.invoke('release', 'ios')).rejects.toMatchObject({
      stderr: expect.stringContaining('Issuer ID is required'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('authentication failure preserves the archive and can be retried without rebuilding', async () => {
    const f = await fixture();
    await expect(f.invoke('release', 'ios', [], { TCG_TEST_ACCOUNT_FAILURE: '1' })).rejects.toMatchObject({
      code: 70,
      stdout: expect.stringContaining('Xcode account authentication failed before transfer'),
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

  test('Devportal inspection allows release with saved team and hostname and no API key', async () => {
    const f = await fixture();
    const status = await inspectApp({ root: f.root, configDirectory: f.config }, 'ios', 0);
    expect(status).toMatchObject({ blocker: null, main: f.sha, fingerprint: appFingerprint('ios', f.sha, settings) });
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
