import {
  checkDevcontainerVersions,
  checkDockerfileVersions,
  parseMiseTools,
  parsePackageManagerVersion,
  parseSwiftToolsVersion,
} from './check-versions-in-sync.ts';

describe('parseMiseTools', () => {
  it('reads the node, swift and pnpm entries from a mise.toml [tools] block', () => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\n';

    expect(parseMiseTools(contents)).toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  it('omits entries that are not present', () => {
    const contents = '[tools]\nnode = "26"\n';

    expect(parseMiseTools(contents)).toStrictEqual({ node: '26' });
  });

  it('ignores tools this script does not check yet, without misparsing the rest', () => {
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\npython = "3.13"\n';

    expect(parseMiseTools(contents)).toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });

  it('parses values regardless of key ordering, comments or blank lines', () => {
    const contents = '[tools]\n# tool versions\nswift = "6.4"\n\nnode = "26"\npnpm = "12.5.1"\n';

    expect(parseMiseTools(contents)).toStrictEqual({ node: '26', swift: '6.4', pnpm: '12.5.1' });
  });
});

describe('checkDockerfileVersions', () => {
  const mise = { node: '26', pnpm: '12.5.1' };
  const defaults = 'ARG NODE_VERSION=26\nARG PNPM_VERSION=12.5.1\n';

  it('accepts global version arguments matching mise.toml and referenced by both images', () => {
    const contents =
      defaults + 'FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies\nFROM node:${NODE_VERSION}-trixie-slim\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([]);
  });

  it('reports drift in Node and pnpm argument defaults', () => {
    const contents =
      'ARG NODE_VERSION=25\nARG PNPM_VERSION=12.4.0\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM node:${NODE_VERSION}-trixie-slim\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '25' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '12.4.0' },
    ]);
  });

  it('rejects a stage that hardcodes its version instead of using the supplied argument', () => {
    const contents =
      defaults +
      'FROM node:${NODE_VERSION} AS build\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies\nFROM node:26-trixie-slim\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      {
        tool: 'node',
        source: 'Dockerfile FROM node:26-trixie-slim',
        expected: '${NODE_VERSION}',
        found: '26-trixie-slim',
      },
    ]);
  });

  it('ignores commented images and reports missing required images', () => {
    const contents =
      defaults + '# FROM node:${NODE_VERSION}-trixie-slim\n# FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM alpine:3\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      { tool: 'node', source: 'Dockerfile FROM node', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile FROM ghcr.io/pnpm/pnpm', expected: '12.5.1', found: '(missing)' },
    ]);
  });

  it('rejects unversioned and latest images that bypass the supplied arguments', () => {
    const contents = defaults + 'FROM node\nFROM ghcr.io/pnpm/pnpm:latest\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      { tool: 'node', source: 'Dockerfile FROM node', expected: '${NODE_VERSION}', found: '(missing)' },
      {
        tool: 'pnpm',
        source: 'Dockerfile FROM ghcr.io/pnpm/pnpm:latest',
        expected: '${PNPM_VERSION}',
        found: 'latest',
      },
    ]);
  });

  it('supports platform flags, case-insensitive instructions and digest-pinned tags', () => {
    const contents =
      defaults +
      'from --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:${PNPM_VERSION}@sha256:abc AS dependencies\nFROM node:${NODE_VERSION}-trixie-slim@sha256:def\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([]);
  });

  it('reports missing defaults even when image arguments are referenced correctly', () => {
    const contents =
      'ARG NODE_VERSION\nARG PNPM_VERSION\nFROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\nFROM node:${NODE_VERSION}-trixie-slim\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '(missing)' },
    ]);
  });

  it('rejects version arguments declared after the first FROM because they cannot configure base images', () => {
    const contents = 'FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION}\n' + defaults + 'FROM node:${NODE_VERSION}-trixie-slim\n';

    expect(checkDockerfileVersions(mise, contents)).toStrictEqual([
      { tool: 'node', source: 'Dockerfile ARG NODE_VERSION', expected: '26', found: '(missing)' },
      { tool: 'pnpm', source: 'Dockerfile ARG PNPM_VERSION', expected: '12.5.1', found: '(missing)' },
    ]);
  });
});

describe('parseSwiftToolsVersion', () => {
  it('reads the swift-tools-version comment from a Package.swift header', () => {
    const contents = '// swift-tools-version: 6.4\nimport PackageDescription\n';

    expect(parseSwiftToolsVersion(contents)).toBe('6.4');
  });

  it('returns undefined when the file has no swift-tools-version comment', () => {
    expect(parseSwiftToolsVersion('import PackageDescription\n')).toBe(undefined);
  });
});

describe('parsePackageManagerVersion', () => {
  it('reads devEngines.packageManager.version from package.json', () => {
    const contents = JSON.stringify({ devEngines: { packageManager: { version: '12.5.1' } } });

    expect(parsePackageManagerVersion(contents)).toBe('12.5.1');
  });

  it('throws when devEngines.packageManager.version is missing', () => {
    expect(() => parsePackageManagerVersion(JSON.stringify({}))).toThrow(Error);
  });
});

describe('checkDevcontainerVersions', () => {
  const mise = { node: '26', swift: '6.4', pnpm: '12.5.1' };

  it('accepts Node and Swift paths that match mise.toml', () => {
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

    expect(checkDevcontainerVersions(mise, contents)).toStrictEqual([]);
  });

  it('reports drifting Node and Swift paths', () => {
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

    expect(checkDevcontainerVersions(mise, contents)).toStrictEqual([
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

  it('reports missing Node and Swift paths', () => {
    const contents = JSON.stringify({ customizations: { vscode: { settings: {} } } });

    expect(checkDevcontainerVersions(mise, contents)).toStrictEqual([
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

  it('reports missing paths when VS Code settings are absent', () => {
    expect(checkDevcontainerVersions(mise, '{}')).toStrictEqual([
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
