import { archiveArguments, exportOptions, inspectArchive, type Command } from './xcode.ts';

const settings = { version: 1, teamID: 'DXUKH9VF73', apiHost: 'api.mintomo.com' } as const;

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
    .mockResolvedValueOnce(JSON.stringify({ ApplicationProperties: { ApplicationPath: 'Applications/Mintomo.app' } }))
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
    'anchor apple generic and certificate leaf[subject.OU] = "DXUKH9VF73"',
    '/tmp/app.xcarchive/Products/Applications/Mintomo.app',
  ]);
});

test('rejects an archive with a different app identity', async () => {
  const command = vi
    .fn<Command>()
    .mockResolvedValueOnce(JSON.stringify({ ApplicationProperties: { ApplicationPath: 'Applications/Mintomo.app' } }))
    .mockResolvedValueOnce(JSON.stringify({ CFBundleIdentifier: 'io.kamaal.TCG.local' }));

  await expect(
    inspectArchive({ archive: '/tmp/app.xcarchive', platform: 'ios', settings, version: '1.0', command }),
  ).rejects.toThrow('does not match');
  expect(command).toHaveBeenCalledTimes(2);
});
