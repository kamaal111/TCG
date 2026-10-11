import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const fixtures: string[] = [];

function invoke(recipe: string, manifest = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg snapshot recipes-'));
  fixtures.push(directory);
  fs.mkdirSync(path.join(directory, 'app'));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.copyFileSync('justfile', path.join(directory, 'justfile'));
  const output = path.join(directory, 'arguments.json');
  fs.writeFileSync(
    path.join(directory, 'scripts/with-ios-simulator-lock'),
    `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(process.env.ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );

  const result = childProcess.spawnSync(
    'just',
    ['--justfile', path.join(directory, 'justfile'), recipe, '-resultBundlePath', '/tmp/results with spaces.xcresult'],
    {
      env: {
        ...process.env,
        ARGUMENTS_FILE: output,
        TCG_APP_IOS_XCTESTRUN: manifest,
        TCG_APP_SOURCE_PACKAGES: '/tmp/source packages',
        TCG_APP_IOS_TEST_DESTINATION: 'platform=iOS Simulator,OS=27.0,name=iPhone 17',
      },
      encoding: 'utf8',
    },
  );

  return { result, output };
}

function argumentsFrom(output: string): string[] {
  return z.array(z.string()).parse(JSON.parse(fs.readFileSync(output, 'utf8')));
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('iOS snapshot recipes', () => {
  it('runs a built manifest without project or package resolution arguments', () => {
    const manifest = '/tmp/built tests/TCG_iphonesimulator27.0-arm64.xctestrun';
    const { result, output } = invoke('test-built-snapshots-ios', manifest);

    expect(result.status).toBe(0);
    const args = argumentsFrom(output);
    expect(args.slice(0, 4)).toEqual([
      '-xctestrun',
      manifest,
      '-destination',
      'platform=iOS Simulator,OS=27.0,name=iPhone 17',
    ]);
    expect(args).not.toContain('-project');
    expect(args).not.toContain('-scheme');
    expect(args).not.toContain('-clonedSourcePackagesDirPath');
    expect(args.filter(argument => argument.startsWith('-only-testing:'))).toEqual([
      '-only-testing:TCGCardsTests/ScreenSnapshotSettlingTests',
      '-only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests',
      '-only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests',
      '-only-testing:TCGCardsTests/TCGCardDetailScreenSnapshotTests',
      '-only-testing:TCGSearchTests/TCGSearchScreenSnapshotTests',
      '-only-testing:TCGSettingsTests/TCGSettingsScreenSnapshotTests',
      '-only-testing:TCGDesignSystemTests/CardImageViewSnapshotTests',
    ]);
    expect(args.slice(-5)).toEqual([
      '-resultBundlePath',
      '/tmp/results with spaces.xcresult',
      'test-without-building',
      'CODE_SIGNING_ALLOWED=NO',
      'SWIFT_EMIT_LOC_STRINGS=YES',
    ]);
  });

  it.each(['test-snapshots-ios', 'build-snapshots-ios', 'test-built-snapshots-ios'])(
    'retains project and package arguments for %s without a manifest',
    recipe => {
      const { result, output } = invoke(recipe);

      expect(result.status).toBe(0);
      expect(argumentsFrom(output).slice(0, 6)).toEqual([
        '-clonedSourcePackagesDirPath',
        '/tmp/source packages',
        '-project',
        'TCG.xcodeproj',
        '-scheme',
        'TCG',
      ]);
      expect(argumentsFrom(output)).not.toContain('-xctestrun');
    },
  );
});
