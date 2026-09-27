import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkDevcontainerVersions,
  parseMiseTools,
  parsePackageManagerVersion,
  parseSwiftToolsVersion,
} from './check-versions-in-sync.ts';

void describe('parseMiseTools', () => {
  void it('reads the node, swift and pnpm entries from a mise.toml [tools] block', () => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\n';

    assert.deepEqual(parseMiseTools(contents), { node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  void it('omits entries that are not present', () => {
    const contents = '[tools]\nnode = "26"\n';

    assert.deepEqual(parseMiseTools(contents), { node: '26' });
  });

  void it('ignores tools this script does not check yet, without misparsing the rest', () => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\npython = "3.13"\n';

    assert.deepEqual(parseMiseTools(contents), { node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  void it('parses values regardless of key ordering, comments or blank lines', () => {
    const contents = '[tools]\n# tool versions\nswift = "6.4"\n\nnode = "26"\npnpm = "12.5.1"\n';

    assert.deepEqual(parseMiseTools(contents), { node: '26', swift: '6.4', pnpm: '12.5.1' });
  });
});

void describe('parseSwiftToolsVersion', () => {
  void it('reads the swift-tools-version comment from a Package.swift header', () => {
    const contents = '// swift-tools-version: 6.4\nimport PackageDescription\n';

    assert.equal(parseSwiftToolsVersion(contents), '6.4');
  });

  void it('returns undefined when the file has no swift-tools-version comment', () => {
    assert.equal(parseSwiftToolsVersion('import PackageDescription\n'), undefined);
  });
});

void describe('parsePackageManagerVersion', () => {
  void it('reads devEngines.packageManager.version from package.json', () => {
    const contents = JSON.stringify({ devEngines: { packageManager: { version: '12.5.1' } } });

    assert.equal(parsePackageManagerVersion(contents), '12.5.1');
  });

  void it('throws when devEngines.packageManager.version is missing', () => {
    assert.throws(() => parsePackageManagerVersion(JSON.stringify({})));
  });
});

void describe('checkDevcontainerVersions', () => {
  const mise = { node: '26', swift: '6.4', pnpm: '12.5.1' };

  void it('accepts Node and Swift paths that match mise.toml', () => {
    const contents = JSON.stringify({
      customizations: {
        vscode: {
          settings: {
            'oxc.path.node': '/root/.local/share/mise/installs/node/26/bin/node',
            'swift.path': '/root/.local/share/mise/installs/swift/6.4/bin',
          },
        },
      },
    });

    assert.deepEqual(checkDevcontainerVersions(mise, contents), []);
  });

  void it('reports drifting Node and Swift paths', () => {
    const contents = JSON.stringify({
      customizations: {
        vscode: {
          settings: {
            'oxc.path.node': '/root/.local/share/mise/installs/node/24/bin/node',
            'swift.path': '/root/.local/share/mise/installs/swift/6.3/bin',
          },
        },
      },
    });

    assert.deepEqual(checkDevcontainerVersions(mise, contents), [
      {
        tool: 'node',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["oxc.path.node"]',
        expected: '/root/.local/share/mise/installs/node/26/bin/node',
        found: '/root/.local/share/mise/installs/node/24/bin/node',
      },
      {
        tool: 'swift',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["swift.path"]',
        expected: '/root/.local/share/mise/installs/swift/6.4/bin',
        found: '/root/.local/share/mise/installs/swift/6.3/bin',
      },
    ]);
  });

  void it('reports missing Node and Swift paths', () => {
    const contents = JSON.stringify({ customizations: { vscode: { settings: {} } } });

    assert.deepEqual(checkDevcontainerVersions(mise, contents), [
      {
        tool: 'node',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["oxc.path.node"]',
        expected: '/root/.local/share/mise/installs/node/26/bin/node',
        found: '(missing)',
      },
      {
        tool: 'swift',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["swift.path"]',
        expected: '/root/.local/share/mise/installs/swift/6.4/bin',
        found: '(missing)',
      },
    ]);
  });

  void it('reports missing paths when VS Code settings are absent', () => {
    assert.deepEqual(checkDevcontainerVersions(mise, '{}'), [
      {
        tool: 'node',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["oxc.path.node"]',
        expected: '/root/.local/share/mise/installs/node/26/bin/node',
        found: '(missing)',
      },
      {
        tool: 'swift',
        source: '.devcontainer/devcontainer.json customizations.vscode.settings["swift.path"]',
        expected: '/root/.local/share/mise/installs/swift/6.4/bin',
        found: '(missing)',
      },
    ]);
  });
});
