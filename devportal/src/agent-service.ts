import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { readPortalSettings } from './config.ts';
import { homePath } from '../../scripts/infra/config.ts';
import { InfraFailure } from '../../scripts/infra/errors.ts';

const label = 'io.kamaal.mintomo-devportal';
const root = url.fileURLToPath(new URL('../../', import.meta.url));
const configDirectory = process.env.TCG_CONFIG_DIRECTORY ?? path.join(os.homedir(), '.config/tcg');
const agentsDirectory = path.join(os.homedir(), 'Library/LaunchAgents');
const plist = path.join(agentsDirectory, `${label}.plist`);
const service = `gui/${process.getuid?.()}/${label}`;

export async function readAgentInstallation(requestedDirectory?: string) {
  const directory = requestedDirectory ?? configDirectory;

  if (!directory.trim()) {
    throw new InfraFailure('TCG_CONFIG_DIRECTORY must not be empty. Existing settings were preserved.');
  }

  try {
    await fs.access(plist);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { installed: false, configDirectory: homePath(directory) };
    }

    throw new InfraFailure(
      'The existing LaunchAgent could not be read. Check file access before rerunning just install-devportal-agent.',
    );
  }

  const savedDirectory = childProcess
    .execFileSync('plutil', ['-extract', 'EnvironmentVariables.TCG_CONFIG_DIRECTORY', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
    })
    .trim();

  if (!savedDirectory) {
    throw new InfraFailure(
      'The installed LaunchAgent has no settings directory. Run just setup-devportal to repair it.',
    );
  }

  if (
    (requestedDirectory || process.env.TCG_CONFIG_DIRECTORY) &&
    path.resolve(homePath(directory)) !== path.resolve(homePath(savedDirectory))
  ) {
    throw new InfraFailure(
      'The requested configuration directory differs from the installed agent. Remove the override and rerun just install-devportal-agent to reuse the saved settings.',
    );
  }

  return { installed: true, configDirectory: homePath(savedDirectory) };
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function manageAgent(action: string, settingsDirectory = configDirectory): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new InfraFailure('The Devportal LaunchAgent requires macOS.');
  }

  if (action === 'status') {
    childProcess.execFileSync('launchctl', ['print', service], { stdio: 'inherit' });

    return;
  }

  if (action === 'stop' || action === 'uninstall') {
    childProcess.spawnSync('launchctl', ['bootout', service], { stdio: 'ignore' });

    if (action === 'stop') {
      return;
    }

    await fs.rm(plist, { force: true });
    console.log('Removed the Devportal LaunchAgent. Settings and release history were preserved.');

    return;
  }

  if (action !== 'install' && action !== 'preview') {
    throw new InfraFailure('Expected install, preview, status, or uninstall.');
  }

  await readPortalSettings(settingsDirectory);

  for (const tool of ['git', 'docker', 'mise', 'just']) {
    childProcess.execFileSync('which', [tool], { stdio: 'pipe' });
  }

  const logDirectory = path.join(settingsDirectory, 'devportal-logs');

  const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>WorkingDirectory</key>
    <string>${xml(root)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(process.execPath)}</string>
        <string>${xml(path.join(root, 'devportal/src/index.ts'))}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(process.env.PATH ?? '/usr/bin:/bin')}</string>
        <key>HOME</key>
        <string>${xml(os.homedir())}</string>
        <key>TCG_CONFIG_DIRECTORY</key>
        <string>${xml(settingsDirectory)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>Umask</key>
    <integer>63</integer>
    <key>StandardOutPath</key>
    <string>${xml(path.join(logDirectory, 'stdout.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(logDirectory, 'stderr.log'))}</string>
</dict>
</plist>
`;

  if (action === 'preview') {
    console.log(document);

    return;
  }

  await fs.mkdir(agentsDirectory, { recursive: true });
  await fs.mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${plist}.${process.pid}.tmp`;

  try {
    await fs.writeFile(temporary, document, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, plist);
  } finally {
    await fs.rm(temporary, { force: true });
  }

  childProcess.spawnSync('launchctl', ['bootout', service], { stdio: 'ignore' });
  childProcess.execFileSync('launchctl', ['bootstrap', `gui/${process.getuid?.()}`, plist], { stdio: 'inherit' });
  childProcess.execFileSync('launchctl', ['print', service], { stdio: 'pipe' });
  console.log('Installed Mintomo Devportal at login; no release was started.');
}
