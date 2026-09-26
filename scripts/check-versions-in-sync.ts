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

  const [miseContents, nodeVersionContents, packageJsonContents] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'mise.toml'), 'utf8'),
    fs.readFile(path.join(repoRoot, '.node-version'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  ]);

  const mise = parseMiseTools(miseContents);
  const nodeVersion = nodeVersionContents.trim();
  const packageManagerVersion = parsePackageManagerVersion(packageJsonContents);

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

  for (const packageFile of packageSwiftFiles) {
    const contents = await fs.readFile(packageFile, 'utf8');
    const toolsVersion = parseSwiftToolsVersion(contents);
    const relativePath = path.relative(repoRoot, packageFile);

    if (toolsVersion === undefined) {
      mismatches.push({ tool: 'swift', source: relativePath, expected: mise.swift, found: '(missing)' });
    } else if (toolsVersion !== mise.swift) {
      mismatches.push({ tool: 'swift', source: relativePath, expected: mise.swift, found: toolsVersion });
    }
  }

  return mismatches;
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

  console.log('✅ Node, pnpm and Swift versions are in sync.');
}
