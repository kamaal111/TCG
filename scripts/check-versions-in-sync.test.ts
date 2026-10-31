import {
  checkDevcontainerVersions,
  checkDockerfileVersions,
  checkInfrastructureVersions,
  checkMiseLockVersions,
  checkWorkflowActionVersions,
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
    const contents = '[tools]\nnode = "26"\nswift = "6.4"\npnpm = "12.5.1"\nruby = "3.4"\n';

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

describe('infrastructure version consistency', () => {
  const root = 'infra/modules/tcg';
  const production = 'infra/environments/production';

  const constraints =
    'terraform {\n  required_version = "= 1.17.1"\n  required_providers {\n    digitalocean = {\n      version = "= 2.106.0"\n    }\n  }\n}';

  const lock =
    'provider "registry.terraform.io/digitalocean/digitalocean" {\n  version = "2.106.0"\n  constraints = "2.106.0"\n}';

  const files = {
    [`${root}/versions.tf`]: constraints,
    [`${production}/versions.tf`]: constraints,
    [`${root}/.terraform.lock.hcl`]: lock,
    [`${production}/.terraform.lock.hcl`]: lock,
  };

  it('accepts matching CLI constraints and independently generated provider locks', () => {
    expect(checkInfrastructureVersions({ terraform: '1.17.1' }, files)).toStrictEqual([]);
  });

  it('reports a drifted production CLI pin, provider constraint, and lock', () => {
    const drifted = {
      ...files,
      [`${production}/versions.tf`]: constraints.replace('1.17.1', '1.16.0').replace('2.106.0', '2.105.0'),
      [`${production}/.terraform.lock.hcl`]: lock.replaceAll('2.106.0', '2.104.0'),
    };

    expect(checkInfrastructureVersions({ terraform: '1.17.1' }, drifted)).toStrictEqual([
      { tool: 'terraform', source: `${production}/versions.tf`, expected: '1.17.1', found: '1.16.0' },
      { tool: 'digitalocean', source: `${production}/versions.tf`, expected: '2.106.0', found: '2.105.0' },
      { tool: 'digitalocean', source: `${production}/.terraform.lock.hcl`, expected: '2.106.0', found: '2.104.0' },
      {
        tool: 'digitalocean',
        source: `${production}/.terraform.lock.hcl constraints`,
        expected: '2.106.0',
        found: '2.104.0',
      },
    ]);
  });

  it('fails when required infrastructure declarations disappear', () => {
    expect(checkInfrastructureVersions({}, {})).toHaveLength(8);
  });

  it('reads Ansible and its controller tools from mise', () => {
    expect(
      parseMiseTools('[tools]\npython = "3.14"\nuv = "0.13.6"\n"pypi:ansible-core" = { version = "2.21.5" }'),
    ).toStrictEqual({
      python: '3.14',
      uv: '0.13.6',
      'pypi:ansible-core': '2.21.5',
    });
  });
});

describe('workflow action version consistency', () => {
  it.each(['v7.0.1', '0123456789abcdef'])('rejects a non-major action reference %s', reference => {
    expect(checkWorkflowActionVersions({ 'ci.yml': `- uses: actions/checkout@${reference}` })).toStrictEqual([
      { tool: 'actions/checkout', source: 'ci.yml', expected: 'a major tag (vN)', found: reference },
    ]);
  });

  it('accepts identical references and ignores local/container actions', () => {
    expect(
      checkWorkflowActionVersions({
        'ci.yml': '- uses: actions/checkout@v7\n- uses: ./local\n- uses: docker://image:1',
        'release.yml': '- uses: actions/checkout@v7',
      }),
    ).toStrictEqual([]);
  });

  it('rejects different major tags for the same action across workflows', () => {
    expect(
      checkWorkflowActionVersions({
        'ci.yml': '- uses: actions/checkout@v7',
        'release.yml': '- uses: actions/checkout@v6',
      }),
    ).toStrictEqual([{ tool: 'actions/checkout', source: 'release.yml', expected: 'v7', found: 'v6' }]);
  });
});

describe('mise tool lock consistency', () => {
  const mise = { terraform: '1.17.1', uv: '0.13.6', python: '3.14', 'pypi:ansible-core': '2.21.5' };

  const lock = `[[tools.terraform]]
version = "1.17.1"
specifiers = ["1.17.1"]
[[tools.uv]]
version = "0.13.6"
specifiers = ["0.13.6"]
[[tools.python]]
version = "3.14.10"
specifiers = ["3.14"]
[[tools."pypi:ansible-core"]]
version = "2.21.5"
specifiers = ["2.21.5"]
`;

  it('accepts exact tools and a Python patch resolving the configured minor', () => {
    expect(checkMiseLockVersions(mise, lock)).toStrictEqual([]);
  });

  it('also checks existing Node and Swift prefix selections', () => {
    expect(
      checkMiseLockVersions(
        { node: '26', swift: '6.4' },
        `[[tools.node]]
version = "26.10.0"
specifiers = ["26"]
[[tools.swift]]
version = "6.4.0"
specifiers = ["6.4"]
`,
      ),
    ).toStrictEqual([]);
  });

  it('rejects a stale lock after updating the mise tool pin', () => {
    expect(checkMiseLockVersions({ ...mise, uv: '0.13.7' }, lock)).toStrictEqual([
      { tool: 'uv', source: 'mise.lock', expected: '0.13.7', found: '0.13.6' },
    ]);
  });

  it('rejects a Python patch from a different minor', () => {
    expect(checkMiseLockVersions(mise, lock.replace('3.14.10', '3.15.0'))).toStrictEqual([
      { tool: 'python', source: 'mise.lock', expected: '3.14', found: '3.15.0' },
    ]);
  });
});
