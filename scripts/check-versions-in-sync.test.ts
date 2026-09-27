import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkDevcontainerVersions,
  checkDockerfileVersions,
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

void describe('checkDockerfileVersions', () => {
  const mise = { node: '26', pnpm: '12.5.1' };
  const defaults = 'ARG NODE_VERSION=26\nARG PNPM_VERSION=12.5.1\n';

  void it('accepts global version arguments matching mise.toml and referenced by both images', () => {
    const contents =
      defaults + 'FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies\nFROM node:${NODE_VERSION}-trixie-slim\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), []);
  });

  void it('reports drift in Node and pnpm argument defaults', () => {
    const contents =
      'ARG NODE_VERSION=25\nARG PNPM_VERSION=12.4.0\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM node:${NODE_VERSION}-trixie-slim\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '25' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '12.4.0' },
    ]);
  });

  void it('rejects a stage that hardcodes its version instead of using the supplied argument', () => {
    const contents =
      defaults +
      'FROM node:${NODE_VERSION} AS build\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies\nFROM node:26-trixie-slim\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      {
        tool: 'node',
        source: 'Dockerfile FROM node:26-trixie-slim',
        expected: '${NODE_VERSION}',
        found: '26-trixie-slim',
      },
    ]);
  });

  void it('ignores commented images and reports missing required images', () => {
    const contents =
      defaults + '# FROM node:${NODE_VERSION}-trixie-slim\n# FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM alpine:3\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      { tool: 'node', source: 'Dockerfile FROM node', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile FROM ghcr.io/pnpm/pnpm', expected: '12.5.1', found: '(missing)' },
    ]);
  });

  void it('rejects unversioned and latest images that bypass the supplied arguments', () => {
    const contents = defaults + 'FROM node\nFROM ghcr.io/pnpm/pnpm:latest\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      { tool: 'node', source: 'Dockerfile FROM node', expected: '${NODE_VERSION}', found: '(missing)' },
      {
        tool: 'pnpm',
        source: 'Dockerfile FROM ghcr.io/pnpm/pnpm:latest',
        expected: '${PNPM_VERSION}',
        found: 'latest',
      },
    ]);
  });

  void it('supports platform flags, case-insensitive instructions and digest-pinned tags', () => {
    const contents =
      defaults +
      'from --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:${PNPM_VERSION}@sha256:abc AS dependencies\nFROM node:${NODE_VERSION}-trixie-slim@sha256:def\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), []);
  });

  void it('reports missing defaults even when image arguments are referenced correctly', () => {
    const contents =
      'ARG NODE_VERSION\nARG PNPM_VERSION\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM node:${NODE_VERSION}-trixie-slim\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '(missing)' },
    ]);
  });

  void it('rejects version arguments declared after the first FROM because they cannot configure base images', () => {
    const contents = 'FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\n' + defaults + 'FROM node:${NODE_VERSION}-trixie-slim\n';

    assert.deepEqual(checkDockerfileVersions(mise, contents), [
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '(missing)' },
    ]);
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
