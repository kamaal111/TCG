import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import z from 'zod';

import { appFingerprint } from './app-release/config.ts';
import { runAppRelease } from './app-release/runtime.ts';
import { setupLocalSigning } from './app-release/setup.ts';
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
    path.join(repository, 'scripts/app-release-signing.py'),
    path.join(root, 'scripts/app-release-signing.py'),
  );
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
  await fs.writeFile(path.join(root, 'app/Configuration/Remote.xcconfig'), '#include "App.xcconfig"\n');
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
  const certificate = Buffer.from('fixture distribution certificate');
  const certificateSHA1 = crypto.createHash('sha1').update(certificate).digest('hex').toUpperCase();
  const signingDirectory = path.join(config, 'app-signing');
  const keychain = path.join(signingDirectory, 'release.keychain-db');
  const home = path.join(directory, 'home');
  const profiles = path.join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles');
  await fs.mkdir(signingDirectory);
  await fs.mkdir(profiles, { recursive: true });
  await fs.writeFile(keychain, 'fixture keychain');
  await fs.writeFile(
    path.join(signingDirectory, 'keychain.json'),
    JSON.stringify({ password: 'fixture keychain password' }),
  );

  for (const platform of ['ios', 'macos']) {
    const profileUUID =
      platform === 'ios' ? '12345678-1234-4234-8234-123456789012' : '12345678-1234-4234-8234-123456789013';

    const profile = `<?xml version="1.0"?><plist version="1.0"><dict><key>UUID</key><string>${profileUUID}</string><key>TeamIdentifier</key><array><string>${settings.teamID}</string></array><key>ApplicationIdentifierPrefix</key><array><string>${settings.teamID}</string></array><key>Platform</key><array><string>${platform === 'ios' ? 'iOS' : 'OSX'}</string></array><key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date><key>DeveloperCertificates</key><array><data>${certificate.toString('base64')}</data></array><key>Entitlements</key><dict><key>application-identifier</key><string>${settings.teamID}.io.kamaal.TCG</string><key>com.apple.developer.team-identifier</key><string>${settings.teamID}</string><key>get-task-allow</key><false/></dict></dict></plist>`;
    await fs.writeFile(path.join(signingDirectory, `${platform}.provisionprofile`), profile);
    await fs.writeFile(
      path.join(profiles, `${profileUUID}.${platform === 'ios' ? 'mobileprovision' : 'provisionprofile'}`),
      profile,
    );
    await fs.writeFile(
      path.join(signingDirectory, `${platform}.json`),
      JSON.stringify({
        version: 1,
        teamID: settings.teamID,
        certificateSHA1,
        profileUUID,
        expiresAt: '2099-01-01T00:00:00+00:00',
        installerSHA1: 'B'.repeat(40),
      }),
    );
  }

  await fs.writeFile(
    path.join(bin, 'security'),
    `#!/bin/bash
printf '%s\n' "$1" >> "$TCG_TEST_SECURITY_CALLS"
case "$1" in
  create-keychain) touch "${'${@: -1}'}" ;;
  import|set-keychain-settings|set-key-partition-list) exit 0 ;;
  cms) cat "${'${@: -1}'}" ;;
  find-identity) printf '1) ${certificateSHA1} "Apple Distribution: Fixture (${settings.teamID})"\n2) ${'B'.repeat(40)} "3rd Party Mac Developer Installer: Fixture (${settings.teamID})"\n' ;;
  list-keychains) printf '    "%s"\n' '${keychain}' ;;
  unlock-keychain) exit 0 ;;
  *) echo 'Unexpected security action' >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  await fs.writeFile(path.join(bin, 'caffeinate'), '#!/bin/bash\nexec sleep 60\n', { mode: 0o755 });
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
 fs.writeFileSync(process.env.TCG_TEST_ARCHIVE_SETTINGS, fs.readFileSync(path.join(process.cwd(),'app/Configuration/Remote.xcconfig')));
 const archive=args[args.indexOf('-archivePath')+1];
 const mac=args.includes('generic/platform=macOS');
 const app=path.join(archive, 'Products/Applications/Mintomo.app');
 const info=path.join(app, mac?'Contents/Info.plist':'Info.plist');
 fs.mkdirSync(path.dirname(info), {recursive:true});
 fs.writeFileSync(path.join(archive,'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CreationDate</key><date>2026-01-02T03:04:05Z</date><key>ApplicationProperties</key><dict><key>CFBundleVersion</key><string>'+args.find(arg=>arg.startsWith('CURRENT_PROJECT_VERSION=')).split('=')[1]+'</string><key>ApplicationPath</key><string>Applications/Mintomo.app</string><key>CFBundleShortVersionString</key><string>1.0</string></dict></dict></plist>');
 fs.writeFileSync(info, JSON.stringify({CFBundleIdentifier:'io.kamaal.TCG',CFBundleShortVersionString:'1.0',CFBundleVersion:args.find(arg=>arg.startsWith('CURRENT_PROJECT_VERSION=')).split('=')[1],CFBundleSupportedPlatforms:[mac?'MacOSX':'iPhoneOS'],TCGAPIBaseURL:'https://api.mintomo.com',TCGAPIEnvironment:'remote'}));
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
    TCG_TEST_SECURITY_CALLS: path.join(directory, 'security-calls'),
    TCG_TEST_ARCHIVE_SETTINGS: path.join(directory, 'archive-settings'),
    HOME: home,
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

  return { root, config, env, sha, calls, invoke, records, summary, directory, signingDirectory, certificateSHA1 };
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
      expect(result.stdout.trim().split('\n').at(-1)).toContain(`Release complete: ${platform} version 1.0 (build 1).`);
      expect(result.stdout).not.toContain('Approve');
      expect(result.stdout).toContain('archive → sign → inspect → export → upload');
      expect(result.stdout).toContain('Upload: separate Apple CLI with private credentials');
      const calls = await f.records();
      expect(calls).toHaveLength(3);
      expect(calls[0]).toContain(destination);
      expect(calls[0]).not.toContain('-allowProvisioningUpdates');
      expect(calls[0]).not.toContain('CODE_SIGN_STYLE=Manual');
      expect(await fs.readFile(f.env.TCG_TEST_ARCHIVE_SETTINGS, 'utf8')).toContain('CODE_SIGN_STYLE = Manual');
      expect(await fs.readFile(f.env.TCG_TEST_ARCHIVE_SETTINGS, 'utf8')).toContain(
        `CODE_SIGN_IDENTITY = ${f.certificateSHA1}`,
      );
      expect(await fs.readFile(path.join(f.root, 'app/Configuration/Remote.xcconfig'), 'utf8')).not.toContain(
        'CODE_SIGN_STYLE = Manual',
      );
      expect(calls[0]).not.toContain('-authenticationKeyPath');
      expect(calls[1]).not.toContain('-allowProvisioningUpdates');
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

  test.each(['ios', 'macos'])(
    'releases %s remotely without checking the display or console session',
    async platform => {
      const f = await fixture();

      for (const tool of ['ioreg', 'stat', 'pmset']) {
        await fs.writeFile(
          path.join(f.directory, 'bin', tool),
          '#!/bin/bash\necho "Unexpected session check" >&2\nexit 1\n',
          {
            mode: 0o755,
          },
        );
      }

      const result = await f.invoke('release', platform);
      expect(result.stdout).toContain('Uploaded to App Store Connect; processing pending.');
      expect(result.stdout).not.toContain('Waiting for the release Mac');
      expect(result.stderr).not.toContain('Unexpected session check');
      expect(await f.records()).toHaveLength(3);
      expect(await f.summary()).toMatchObject({ state: 'uploaded' });
    },
  );

  test('a failed idle-sleep helper does not block release', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, 'bin/caffeinate'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    const result = await f.invoke('release', 'ios');
    expect(result.stdout).toContain('Uploaded to App Store Connect; processing pending.');
    expect(await f.records()).toHaveLength(3);
    expect(await f.summary()).toMatchObject({ state: 'uploaded' });
  });

  test('missing local signing assets stop before building instead of using Xcode accounts', async () => {
    const f = await fixture();
    await fs.rm(f.signingDirectory, { recursive: true });
    await expect(f.invoke('release', 'ios')).rejects.toMatchObject({
      stdout: expect.stringContaining('Local ios signing is not configured'),
    });
    expect(await f.records()).toEqual([]);
  });

  test.each([
    ['expired profile', 'ExpirationDate', '-date', '2000-01-01T00:00:00Z'],
    ['development profile', 'Entitlements.get-task-allow', '-bool', 'YES'],
    ['wrong team', 'TeamIdentifier.0', '-string', 'AAAAAAAAAA'],
    ['wrong platform', 'Platform', '-json', '["OSX"]'],
    ['wrong app', 'Entitlements.application-identifier', '-string', 'DXUKH9VF73.other.app'],
  ])('rejects a %s before building', async (_label, key, type, value) => {
    const f = await fixture();
    await execute('plutil', ['-replace', key, type, value, path.join(f.signingDirectory, 'ios.provisionprofile')]);
    await expect(f.invoke('release', 'ios')).rejects.toMatchObject({
      stdout: expect.stringContaining('Use a current App Store distribution profile'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('rejects a profile whose signing certificate has no matching private key before building', async () => {
    const f = await fixture();
    await execute('plutil', [
      '-remove',
      'DeveloperCertificates.0',
      path.join(f.signingDirectory, 'ios.provisionprofile'),
    ]);
    await execute('plutil', [
      '-insert',
      'DeveloperCertificates.0',
      '-data',
      Buffer.from('other certificate').toString('base64'),
      path.join(f.signingDirectory, 'ios.provisionprofile'),
    ]);
    await expect(f.invoke('release', 'ios')).rejects.toMatchObject({
      stdout: expect.stringContaining('no matching usable distribution certificate/private key'),
    });
    expect(await f.records()).toEqual([]);
  });

  test('uses the explicit local distribution certificate and profile during export', async () => {
    const f = await fixture();
    await f.invoke('release', 'macos');
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const file = path.join(f.config, 'app-releases', sessions[0] ?? '', 'ExportOptions.plist');
    expect((await execute('plutil', ['-extract', 'signingStyle', 'raw', '-o', '-', file])).stdout.trim()).toBe(
      'manual',
    );
    expect((await execute('plutil', ['-extract', 'signingCertificate', 'raw', '-o', '-', file])).stdout.trim()).toBe(
      f.certificateSHA1,
    );
    expect(
      (await execute('plutil', ['-extract', 'installerSigningCertificate', 'raw', '-o', '-', file])).stdout.trim(),
    ).toBe('B'.repeat(40));
    expect((await f.records()).flat()).not.toContain('-allowProvisioningUpdates');
    expect((await fs.readFile(f.env.TCG_TEST_SECURITY_CALLS, 'utf8')).split('\n')).not.toContain('import');
    expect((await fs.readFile(f.env.TCG_TEST_SECURITY_CALLS, 'utf8')).split('\n')).not.toContain(
      'set-key-partition-list',
    );
  });

  test('setup imports local signing into its private keychain and reuses it without asking again', async () => {
    const f = await fixture();
    const profile = path.join(f.directory, 'downloaded.mobileprovision');
    await fs.copyFile(path.join(f.signingDirectory, 'ios.provisionprofile'), profile);
    await fs.rm(path.join(f.signingDirectory, 'ios.json'));
    await fs.rm(path.join(f.signingDirectory, 'keychain.json'));
    await fs.rm(path.join(f.signingDirectory, 'release.keychain-db'));
    vi.stubEnv('PATH', f.env.PATH);
    vi.stubEnv('HOME', f.env.HOME);
    vi.stubEnv('TCG_TEST_SECURITY_CALLS', f.env.TCG_TEST_SECURITY_CALLS);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const text = vi
      .fn<Prompts['text']>()
      .mockResolvedValueOnce(path.join(f.directory, 'distribution.p12'))
      .mockResolvedValueOnce(profile);

    const password = vi.fn<Prompts['password']>().mockResolvedValue('fixture p12 password');
    const note = vi.fn<Prompts['note']>();

    const prompts: Prompts = {
      text,
      password,
      note,
      confirm: vi.fn<Prompts['confirm']>(),
      select: vi.fn<Prompts['select']>(),
      multiselect: vi.fn<Prompts['multiselect']>(),
    };

    await setupLocalSigning({ directory: f.config, platform: 'ios', team: settings.teamID, prompts });
    await setupLocalSigning({ directory: f.config, platform: 'ios', team: settings.teamID, prompts });
    expect(text).toHaveBeenCalledTimes(2);
    expect(password).toHaveBeenCalledTimes(1);
    expect((await fs.stat(path.join(f.signingDirectory, 'keychain.json'))).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(f.signingDirectory, 'keychain.json'), 'utf8')).not.toContain(
      'fixture p12 password',
    );
    expect(note.mock.calls.flat().join(' ')).not.toContain('fixture p12 password');
    const actions = (await fs.readFile(f.env.TCG_TEST_SECURITY_CALLS, 'utf8')).split('\n');
    expect(actions).toContain('create-keychain');
    expect(actions).toContain('import');
    expect(actions).toContain('set-key-partition-list');
  });

  test('native signing errors are visible while keychain passwords remain private', async () => {
    const f = await fixture();
    await fs.writeFile(
      path.join(f.directory, 'bin/security'),
      '#!/bin/bash\necho "User interaction is not allowed: fixture keychain password" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    await expect(f.invoke('archive', 'ios')).rejects.toMatchObject({
      stdout: expect.stringContaining('User interaction is not allowed: [private password]'),
    });
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const log = await fs.readFile(path.join(f.config, 'app-releases', sessions[0] ?? '', 'release.log'), 'utf8');
    expect(log).not.toContain('fixture keychain password');
    expect(await f.records()).toEqual([]);
  });

  test('Devportal reports missing local signing setup before starting a release', async () => {
    const f = await fixture();
    await fs.rm(path.join(f.signingDirectory, 'ios.json'));
    const status = await inspectApp({ root: f.root, configDirectory: f.config }, 'ios', 0);
    expect(status.blocker).toContain('Local distribution signing setup is required');
    expect(status.blocker).toContain('--platform ios');
    expect(await f.records()).toEqual([]);
  });

  test('archive-only uses local signing without account updates or upload', async () => {
    const f = await fixture();
    const result = await f.invoke('archive', 'ios');
    expect(result.stdout).toContain('Archive ready:');
    expect(await f.records()).toHaveLength(1);
    expect((await f.records())[0]).not.toContain('-allowProvisioningUpdates');
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

  test('upload-only reports the retained archive version and build in the final message', async () => {
    const f = await fixture();
    await f.invoke('archive', 'ios');
    const sessions = await fs.readdir(path.join(f.config, 'app-releases'));
    const archive = path.join(f.config, 'app-releases', sessions[0] ?? '', 'Mintomo.xcarchive');
    await execute('plutil', [
      '-replace',
      'ApplicationProperties.CFBundleVersion',
      '-string',
      '42',
      path.join(archive, 'Info.plist'),
    ]);
    const result = await f.invoke('upload', 'ios', [archive]);
    expect(result.stdout.trim().split('\n').at(-1)).toContain('Release complete: ios version 1.0 (build 42).');
    expect((await f.records()).filter(args => args.includes('archive'))).toHaveLength(1);
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
    vi.stubEnv('HOME', f.env.HOME);
    vi.stubEnv('TCG_TEST_CALLS', f.calls);
    vi.stubEnv('TCG_TEST_SECURITY_CALLS', f.env.TCG_TEST_SECURITY_CALLS);
    vi.stubEnv('TCG_TEST_ARCHIVE_SETTINGS', f.env.TCG_TEST_ARCHIVE_SETTINGS);
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
