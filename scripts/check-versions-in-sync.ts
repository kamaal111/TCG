import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

import * as toml from 'smol-toml';
import z from 'zod';

const repoRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const MiseToolsSchema = z.object({
  tools: z.object({
    node: z.string().optional(),
    swift: z.string().optional(),
    pnpm: z.string().optional(),
  }),
});

type MiseTools = z.infer<typeof MiseToolsSchema>['tools'];

const PackageJsonSchema = z.object({
  devEngines: z.object({
    packageManager: z.object({
      version: z.string(),
    }),
  }),
});

const DevcontainerSchema = z.object({
  customizations: z
    .object({
      vscode: z
        .object({
          settings: z
            .object({
              'oxc.path.node': z.string().optional(),
              'swift.path': z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

interface Mismatch {
  tool: string;
  source: string;
  expected: string;
  found: string;
}

export function parseMiseTools(contents: string): MiseTools {
  return MiseToolsSchema.parse(toml.parse(contents)).tools;
}

export function parseSwiftToolsVersion(contents: string): string | undefined {
  return contents.match(/^\/\/ swift-tools-version:\s*([0-9.]+)/m)?.[1];
}

export function parsePackageManagerVersion(contents: string): string {
  return PackageJsonSchema.parse(JSON.parse(contents)).devEngines.packageManager.version;
}

export function checkDevcontainerVersions(mise: MiseTools, contents: string): Mismatch[] {
  const settings = DevcontainerSchema.parse(JSON.parse(contents)).customizations?.vscode?.settings;
  const mismatches: Mismatch[] = [];

  const paths = [
    { tool: 'node', setting: 'oxc.path.node', expected: `/root/.local/share/mise/installs/node/${mise.node}/bin/node` },
    { tool: 'swift', setting: 'swift.path', expected: `/root/.local/share/mise/installs/swift/${mise.swift}/bin` },
  ] as const;

  for (const { tool, setting, expected } of paths) {
    if (mise[tool] === undefined) {
      continue;
    }

    const found = settings?.[setting];

    if (found !== expected) {
      mismatches.push({
        tool,
        source: `.devcontainer/devcontainer.json customizations.vscode.settings["${setting}"]`,
        expected,
        found: found ?? '(missing)',
      });
    }
  }

  return mismatches;
}

export function checkDockerfileVersions(mise: MiseTools, contents: string): Mismatch[] {
  const images = Array.from(contents.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim), match => match[1] ?? '');
  const globalContents = contents.split(/^\s*FROM\b/im)[0] ?? '';

  const argumentsByName = new Map<string, string | undefined>(
    Array.from(globalContents.matchAll(/^\s*ARG\s+(\w+)(?:=(\S+))?\s*$/gim), match => [match[1] ?? '', match[2]]),
  );

  const mismatches: Mismatch[] = [];

  const tools = [
    { tool: 'node', repository: 'node', argument: 'NODE_VERSION' },
    { tool: 'pnpm', repository: 'ghcr.io/pnpm/pnpm', argument: 'PNPM_VERSION' },
  ] as const;

  for (const { tool, repository, argument } of tools) {
    const expected = mise[tool];

    if (expected === undefined) {
      continue;
    }

    const defaultVersion = argumentsByName.get(argument);

    if (defaultVersion !== expected) {
      mismatches.push({ tool, source: `Dockerfile ARG ${argument}`, expected, found: defaultVersion ?? '(missing)' });
    }

    const toolImages = images.filter(
      image => image === repository || image.startsWith(`${repository}:`) || image.startsWith(`${repository}@`),
    );

    if (toolImages.length === 0) {
      mismatches.push({ tool, source: `Dockerfile FROM ${repository}`, expected, found: '(missing)' });
    }

    for (const image of toolImages) {
      const tag = image.split('@')[0]?.slice(repository.length + 1);
      const argumentTag = `\${${argument}}`;
      const usesArgument = tag === argumentTag || (tool === 'node' && tag?.startsWith(`${argumentTag}-`));

      if (!usesArgument) {
        mismatches.push({ tool, source: `Dockerfile FROM ${image}`, expected: argumentTag, found: tag || '(missing)' });
      }
    }
  }

  return mismatches;
}

async function collectPackageSwiftFiles(): Promise<string[]> {
  const packageFiles: string[] = [];

  const matches = fs.glob('**/Package.swift', {
    cwd: repoRoot,
    exclude: matchedPath => matchedPath.includes('node_modules') || matchedPath.includes('.build'),
  });

  for await (const matchedPath of matches) {
    packageFiles.push(path.join(repoRoot, matchedPath));
  }

  return packageFiles;
}

async function checkVersionsInSync(): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = [];

  const [miseContents, nodeVersionContents, packageJsonContents, devcontainerContents, dockerfileContents] =
    await Promise.all([
      fs.readFile(path.join(repoRoot, 'mise.toml'), 'utf8'),
      fs.readFile(path.join(repoRoot, '.node-version'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
      fs.readFile(path.join(repoRoot, '.devcontainer/devcontainer.json'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'Dockerfile'), 'utf8'),
    ]);

  const mise = parseMiseTools(miseContents);
  const nodeVersion = nodeVersionContents.trim();
  const packageManagerVersion = parsePackageManagerVersion(packageJsonContents);

  mismatches.push(...checkDevcontainerVersions(mise, devcontainerContents));
  mismatches.push(...checkDockerfileVersions(mise, dockerfileContents));

  if (mise.node === undefined) {
    mismatches.push({ tool: 'node', source: 'mise.toml', expected: '(a node entry)', found: '(missing)' });
  } else if (mise.node !== nodeVersion) {
    mismatches.push({ tool: 'node', source: '.node-version', expected: mise.node, found: nodeVersion });
  }

  if (mise.pnpm === undefined) {
    mismatches.push({ tool: 'pnpm', source: 'mise.toml', expected: '(a pnpm entry)', found: '(missing)' });
  } else if (mise.pnpm !== packageManagerVersion) {
    mismatches.push({
      tool: 'pnpm',
      source: 'package.json devEngines.packageManager.version',
      expected: mise.pnpm,
      found: packageManagerVersion,
    });
  }

  if (mise.swift === undefined) {
    mismatches.push({ tool: 'swift', source: 'mise.toml', expected: '(a swift entry)', found: '(missing)' });

    return mismatches;
  }

  const packageSwiftFiles = await collectPackageSwiftFiles();

  const packageSwiftMismatches = await Promise.all(
    packageSwiftFiles.map(async packageFile => {
      const contents = await fs.readFile(packageFile, 'utf8');
      const toolsVersion = parseSwiftToolsVersion(contents);
      const relativePath = path.relative(repoRoot, packageFile);

      if (toolsVersion === undefined) {
        return { tool: 'swift', source: relativePath, expected: mise.swift, found: '(missing)' };
      } else if (toolsVersion !== mise.swift) {
        return { tool: 'swift', source: relativePath, expected: mise.swift, found: toolsVersion };
      }

      return null;
    }),
  );

  return mismatches.concat(packageSwiftMismatches.filter((miss): miss is Mismatch => miss != null));
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const mismatches = await checkVersionsInSync();

  if (mismatches.length > 0) {
    console.error('❌ Tool versions have drifted out of sync:');

    for (const mismatch of mismatches) {
      console.error(`   ${mismatch.tool} (${mismatch.source}): expected ${mismatch.expected}, found ${mismatch.found}`);
    }

    console.error('Update mise.toml and the drifted file(s) so they match.');
    process.exit(1);
  }

  console.log('✅ Node, pnpm and Swift versions are in sync, including Docker images and dev container paths.');
}
