import path from 'node:path';

import z from 'zod';

import type { AppSettings, Platform } from './config.ts';
import { InfraFailure } from '../infra/errors.ts';

export type Command = (program: string, args: string[], cwd?: string) => Promise<string>;

const DESTINATION = { ios: 'generic/platform=iOS', macos: 'generic/platform=macOS' } as const;

export function archiveArguments(options: { platform: Platform; archive: string; settings: AppSettings }): string[] {
  return [
    '-project',
    'app/TCG.xcodeproj',
    '-scheme',
    'TCG',
    '-configuration',
    'Release',
    '-destination',
    DESTINATION[options.platform],
    '-archivePath',
    options.archive,
    'archive',
    '-allowProvisioningUpdates',
    'CODE_SIGN_STYLE=Automatic',
    'CODE_SIGNING_ALLOWED=YES',
    `DEVELOPMENT_TEAM=${options.settings.teamID}`,
    `TCG_API_HOST=${options.settings.apiHost}`,
    'ONLY_ACTIVE_ARCH=NO',
    'SWIFT_USE_INTEGRATED_DRIVER=NO',
  ];
}

export function exportOptions(settings: AppSettings): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${settings.teamID}</string>
<key>manageAppVersionAndBuildNumber</key><true/>
<key>uploadSymbols</key><true/>
</dict></plist>\n`;
}

export async function inspectArchive(options: {
  archive: string;
  platform: Platform;
  settings: AppSettings;
  version: string;
  command: Command;
}): Promise<void> {
  const { archive, platform, settings, version, command } = options;

  // Archive CreationDate is a plist date, which cannot be converted to JSON.
  const metadata = z
    .object({ ApplicationPath: z.string() })
    .parse(
      JSON.parse(
        await command('plutil', [
          '-extract',
          'ApplicationProperties',
          'json',
          '-o',
          '-',
          path.join(archive, 'Info.plist'),
        ]),
      ),
    );

  const application = metadata.ApplicationPath;

  if (!application.startsWith('Applications/') || application.includes('..') || !application.endsWith('.app')) {
    throw new InfraFailure('Archive contains an unexpected application path. Upload stopped.');
  }

  const app = path.join(archive, 'Products', application);
  const plist = path.join(app, platform === 'macos' ? 'Contents/Info.plist' : 'Info.plist');

  const info = z
    .object({
      CFBundleIdentifier: z.literal('io.kamaal.TCG'),
      CFBundleShortVersionString: z.literal(version),
      CFBundleSupportedPlatforms: z.array(z.string()),
      TCGAPIBaseURL: z.literal(`https://${settings.apiHost}`),
      TCGAPIEnvironment: z.literal('remote'),
    })
    .safeParse(JSON.parse(await command('plutil', ['-convert', 'json', '-o', '-', plist])));

  if (!info.success || !info.data.CFBundleSupportedPlatforms.includes(platform === 'ios' ? 'iPhoneOS' : 'MacOSX')) {
    throw new InfraFailure(
      'Archive identity, platform, version or production endpoint does not match the release. Upload stopped.',
    );
  }

  await command('codesign', ['--verify', '--deep', '--strict', app]);
  await command('codesign', [
    '--verify',
    '-R',
    `=anchor apple generic and certificate leaf[subject.OU] = "${settings.teamID}"`,
    app,
  ]);
}
