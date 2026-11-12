import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { archiveArguments, exportOptions, inspectArchive, type Command } from './xcode.ts';

const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;
const execute = util.promisify(childProcess.execFile);

test.each([
  ['ios', 'generic/platform=iOS'],
  ['macos', 'generic/platform=macOS'],
] as const)('archives %s with release signing independent of unsigned tests', (platform, destination) => {
  const args = archiveArguments({ platform, archive: '/tmp/release with spaces/app.xcarchive', settings });
  expect(args).toContain(destination);
  expect(args).toContain('CODE_SIGNING_ALLOWED=YES');
  expect(args).toContain('CODE_SIGN_STYLE=Automatic');
  expect(args).toContain('-allowProvisioningUpdates');
  expect(args).toContain('TCG_API_HOST=api.mintomo.com');
  expect(args).toContain('ONLY_ACTIVE_ARCH=NO');
  expect(args).toContain('SWIFT_USE_INTEGRATED_DRIVER=NO');
  expect(exportOptions(settings)).toContain('<key>manageAppVersionAndBuildNumber</key><true/>');
  expect(exportOptions(settings)).toContain('<key>method</key><string>app-store-connect</string>');
});

test.each([
  ['ios', 'iPhoneOS', 'Info.plist'],
  ['macos', 'MacOSX', 'Contents/Info.plist'],
] as const)('validates the archived %s app and signing team before upload', async (platform, supported, plist) => {
  const command = vi
    .fn<Command>()
    .mockResolvedValueOnce(JSON.stringify({ ApplicationPath: 'Applications/Mintomo.app' }))
    .mockResolvedValueOnce(
      JSON.stringify({
        CFBundleIdentifier: 'io.kamaal.TCG',
        CFBundleShortVersionString: '1.0',
        CFBundleSupportedPlatforms: [supported],
        TCGAPIBaseURL: 'https://api.mintomo.com',
        TCGAPIEnvironment: 'remote',
      }),
    )
    .mockResolvedValue('');

  await inspectArchive({ archive: '/tmp/app.xcarchive', platform, settings, version: '1.0', command });
  expect(command).toHaveBeenNthCalledWith(2, 'plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    `/tmp/app.xcarchive/Products/Applications/Mintomo.app/${plist}`,
  ]);
  expect(command).toHaveBeenLastCalledWith('codesign', [
    '--verify',
    '-R',
    '=anchor apple generic and certificate leaf[subject.OU] = "DXUKH9VF73"',
    '/tmp/app.xcarchive/Products/Applications/Mintomo.app',
  ]);
});

test('rejects an archive with a different app identity', async () => {
  const command = vi
    .fn<Command>()
    .mockResolvedValueOnce(JSON.stringify({ ApplicationPath: 'Applications/Mintomo.app' }))
    .mockResolvedValueOnce(JSON.stringify({ CFBundleIdentifier: 'io.kamaal.TCG.local' }));

  await expect(
    inspectArchive({ archive: '/tmp/app.xcarchive', platform: 'ios', settings, version: '1.0', command }),
  ).rejects.toThrow('does not match');
  expect(command).toHaveBeenCalledTimes(2);
});

describe.runIf(process.platform === 'darwin')('native archive plists', () => {
  test('uses an inline native signing requirement and rejects a different signing team', async () => {
    const command = vi
      .fn<Command>()
      .mockResolvedValueOnce(JSON.stringify({ ApplicationPath: 'Applications/Mintomo.app' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          CFBundleIdentifier: 'io.kamaal.TCG',
          CFBundleShortVersionString: '1.0',
          CFBundleSupportedPlatforms: ['iPhoneOS'],
          TCGAPIBaseURL: 'https://api.mintomo.com',
          TCGAPIEnvironment: 'remote',
        }),
      )
      .mockResolvedValueOnce('')
      .mockImplementation(
        async (program, args) => (await execute(program, [...args.slice(0, -1), '/usr/bin/true'])).stdout,
      );

    await expect(
      inspectArchive({ archive: '/tmp/app.xcarchive', platform: 'ios', settings, version: '1.0', command }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining('failed to satisfy specified code requirement'),
    });
  });
  test.each([
    { platform: 'ios', supported: 'iPhoneOS', plist: 'Info.plist', format: 'xml1' },
    { platform: 'macos', supported: 'MacOSX', plist: 'Contents/Info.plist', format: 'binary1' },
  ] as const)('reads a dated $format $platform archive with native plutil without rewriting it', async entry => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dated archive-'));
    onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
    const app = path.join(directory, 'Products/Applications/Mintomo.app');
    const metadata = path.join(directory, 'Info.plist');
    const plist = path.join(app, entry.plist);
    await fs.mkdir(path.dirname(plist), { recursive: true });
    await fs.writeFile(
      metadata,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CreationDate</key><date>2026-01-02T03:04:05Z</date>
<key>ApplicationProperties</key><dict><key>ApplicationPath</key><string>Applications/Mintomo.app</string></dict>
</dict></plist>`,
    );
    await fs.writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.kamaal.TCG</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleSupportedPlatforms</key><array><string>${entry.supported}</string></array>
<key>TCGAPIBaseURL</key><string>https://api.mintomo.com</string>
<key>TCGAPIEnvironment</key><string>remote</string>
</dict></plist>`,
    );
    await execute('/usr/bin/plutil', ['-convert', entry.format, metadata]);
    const before = await fs.readFile(metadata);

    const command = vi.fn<Command>(async (program, args) => {
      if (program === 'codesign') {
        return '';
      }

      return (await execute(program, args)).stdout;
    });

    await inspectArchive({ archive: directory, platform: entry.platform, settings, version: '1.0', command });
    expect(command.mock.calls.filter(call => call[0] === 'codesign')).toHaveLength(2);
    expect(await fs.readFile(metadata)).toEqual(before);
  });
});
