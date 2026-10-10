import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import type { TestContext } from 'vitest';

import { checkCatalogs, translated, type JSONValue } from './check-localizations.ts';

const script = url.fileURLToPath(new URL('./check-localizations.ts', import.meta.url));

const repo = path.dirname(path.dirname(script));

const label = 'Modules/Features/Sources/Search/Localizable.xcstrings';

const unit = (state = 'translated', value = 'Zoekhulp') => ({ stringUnit: { state, value } });

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localizations-'));
  t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const owner = path.join(app, 'Modules/Features/Sources/Search');
  const source = path.join(owner, 'Screen.swift');
  const build = path.join(root, 'build');
  const output = path.join(build, 'Features.build/Debug/Search.build/Objects-normal/arm64');
  fs.mkdirSync(owner, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(source, 'Text("How to search")');
  const write = (file: string, value: JSONValue) => fs.writeFileSync(file, JSON.stringify(value));
  const fileList = path.join(output, 'Search.SwiftFileList');
  fs.writeFileSync(fileList, quote(source) + '\n');

  const extract = (keys: JSONValue[], table = 'Localizable', sourceFile = source, directory = output) =>
    write(path.join(directory, `${path.basename(sourceFile, '.swift')}.stringsdata`), {
      source: sourceFile,
      tables: { [table]: keys.map(key => ({ key })) },
      version: 1,
    });

  const catalog = (entries: Record<string, JSONValue>, table = 'Localizable') =>
    write(path.join(owner, `${table}.xcstrings`), { sourceLanguage: 'en', strings: entries, version: '1.0' });

  extract(['How to search']);

  return {
    root,
    app,
    owner,
    source,
    build,
    output,
    fileList,
    write,
    extract,
    catalog,
    check: (configuration = 'Debug') => checkCatalogs(app, build, configuration),
  };
}

test('accepts source-language fallback', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  expect(f.check()).toStrictEqual([]);
});

test('reports missing catalogs', t => {
  const f = fixture(t);
  expect(f.check()).toStrictEqual([`${label}: missing string catalog (1 extracted keys).`]);
});

test('reports missing keys', t => {
  const f = fixture(t);
  f.catalog({});
  expect(f.check()).toStrictEqual([`${label}: missing key 'How to search'.`]);
});

test('isolates catalog ownership', t => {
  const f = fixture(t);
  const other = path.join(f.app, 'Modules/Other/Sources/Other');
  fs.mkdirSync(other, { recursive: true });
  f.write(path.join(other, 'Localizable.xcstrings'), { sourceLanguage: 'en', strings: { 'How to search': {} } });
  expect(f.check()).toStrictEqual([`${label}: missing string catalog (1 extracted keys).`]);
});

test('checks iOS extraction independently', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  const ios = f.output.replace('/Debug/', '/Debug-iphonesimulator/');
  fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(ios, 'Search.SwiftFileList'), quote(f.source) + '\n');
  f.extract(['How to search', 'Done'], 'Localizable', f.source, ios);
  expect(f.check('Debug-iphonesimulator')).toStrictEqual([`${label}: missing key 'Done'.`]);
  expect(f.check()).toStrictEqual([]);
});

test('reports disabled compiler extraction', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.output, 'Screen.stringsdata'));
  expect(f.check()).toStrictEqual([
    'Modules/Features/Sources/Search/Screen.swift: no compiler string extraction; enable SWIFT_EMIT_LOC_STRINGS.',
  ]);
});

test('reports absent compilation inputs', t => {
  const f = fixture(t);
  fs.unlinkSync(f.fileList);
  expect(f.check()).toStrictEqual(['No app compilation inputs found for Debug. Run the matching app tests first.']);
});

test('honors custom tables', t => {
  const f = fixture(t);
  f.extract(['How to search'], 'Help');
  f.catalog({ 'How to search': {} }, 'Help');
  expect(f.check()).toStrictEqual([]);
});

test('excludes dependencies and nonlocalizable literals', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  f.extract(['Dependency key'], 'Localizable', path.join(f.root, 'dependency/External.swift'));
  fs.writeFileSync(f.source, 'Text("How to search"); Text(verbatim: "sv5m 072/071")');
  expect(f.check()).toStrictEqual([]);
});

test('requires completed declared translations', t => {
  const f = fixture(t);
  f.extract(['How to search', 'Done']);
  f.catalog({
    'How to search': { localizations: { nl: unit() } },
    Done: { localizations: { nl: unit('needs_review') } },
  });
  expect(f.check()).toStrictEqual([`${label}: 'Done' has no completed nl translation.`]);
});

test('accepts translation exemptions', t => {
  const f = fixture(t);
  f.extract(['How to search', 'TCG']);
  f.catalog({ 'How to search': { localizations: { nl: unit() } }, TCG: { shouldTranslate: false } });
  expect(f.check()).toStrictEqual([]);
});

test('collects languages repository-wide and excludes each source language', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  f.write(path.join(f.app, 'Other.xcstrings'), {
    sourceLanguage: 'nl',
    strings: { Other: { localizations: { en: unit(), fr: unit() } } },
  });
  expect(f.check()).toStrictEqual([`${label}: 'How to search' has no completed fr translation.`]);
});

test('requires every plural variant', () => {
  expect(translated({ variations: { plural: { one: unit(), other: unit('new') } } })).toBe(false);
});

test('accepts completed plural variants', () => {
  expect(translated({ variations: { plural: { one: unit(), other: unit() } } })).toBe(true);
});

test('requires completed substitution variants', () => {
  expect(translated({ ...unit(), substitutions: { count: { variations: { plural: { other: unit('new') } } } } })).toBe(
    false,
  );
});

test('accepts completed substitution variants', () => {
  expect(translated({ ...unit(), substitutions: { count: { variations: { plural: { other: unit() } } } } })).toBe(true);
});

for (const value of [
  null,
  [],
  {},
  { stringUnit: null },
  { stringUnit: { state: 'translated', value: 1 } },
  { variations: {} },
  { variations: { plural: {} } },
  { variations: { plural: [] } },
  { ...unit(), substitutions: null },
  { ...unit(), substitutions: [] },
]) {
  test(`rejects incomplete translation ${JSON.stringify(value)}`, () => {
    expect(translated(value)).toBe(false);
  });
}

for (const value of ['not JSON', '{}', '{"source":1,"tables":{}}', '{"source":"x","tables":[]}']) {
  test(`rejects malformed extraction ${value}`, t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.output, 'Screen.stringsdata'), value);
    expect(f.check).toThrow(Error);
  });
}

const malformedCatalogs: JSONValue[] = [
  null,
  [],
  {},
  { sourceLanguage: 'en', strings: [] },
  { sourceLanguage: 'en', strings: { x: null } },
  { sourceLanguage: 'en', strings: { x: { localizations: [] } } },
  { sourceLanguage: 'en', strings: { x: { shouldTranslate: 'false' } } },
];

for (const value of malformedCatalogs) {
  test(`rejects malformed catalog ${JSON.stringify(value)}`, t => {
    const f = fixture(t);
    f.write(path.join(f.owner, 'Localizable.xcstrings'), value);
    expect(f.check).toThrow(Error);
  });
}

for (const table of ['', '.', '..', '../Other', '/Other']) {
  test(`rejects invalid table ${JSON.stringify(table)}`, t => {
    const f = fixture(t);
    f.extract(['x'], table);
    expect(f.check).toThrow(/Invalid localization table/);
  });
}

test('rejects non-string extracted keys', t => {
  const f = fixture(t);
  f.extract([1]);
  expect(f.check).toThrow(/Invalid localization key/);
});

test('rejects malformed table entries', t => {
  const f = fixture(t);
  f.write(path.join(f.output, 'Screen.stringsdata'), { source: f.source, tables: { Localizable: {} } });
  expect(f.check).toThrow(/Invalid localization entries/);
});

for (const name of ['Screen with spaces.swift', "Screen'quote.swift", 'Screen"quote.swift', 'Screen\\slash.swift']) {
  test(`parses shell quoted path ${name}`, t => {
    const f = fixture(t);
    const source = path.join(f.owner, name);
    fs.writeFileSync(f.fileList, quote(source) + '\n');
    f.extract(['How to search'], 'Localizable', source);
    f.catalog({ 'How to search': {} });
    expect(f.check()).toStrictEqual([]);
  });
}

test('parses double quotes and backslash escapes', t => {
  const f = fixture(t);
  const source = path.join(f.owner, 'Screen "with" \\spaces.swift');
  fs.writeFileSync(
    f.fileList,
    '"' + source.replace(/(["\\])/g, '\\$1') + '"\n' + source.replace(/([\s"\\])/g, '\\$1') + '\n',
  );
  f.extract(['How to search'], 'Localizable', source);
  f.catalog({ 'How to search': {} });
  expect(f.check()).toStrictEqual([]);
});

for (const entry of ['', 'two paths', "'unterminated", 'dangling\\', "''"]) {
  test(`rejects invalid file-list entry ${JSON.stringify(entry)}`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.fileList, entry + '\n');
    expect(f.check).toThrow(/Invalid Swift file list entry/);
  });
}

test('does not claim sources in sibling directories', t => {
  const f = fixture(t);
  const sibling = path.join(f.app, 'TCGSibling', 'Screen.swift');
  fs.mkdirSync(path.dirname(sibling));
  fs.writeFileSync(f.fileList, quote(sibling) + '\n');
  f.extract(['x'], 'Localizable', sibling);
  expect(f.check()).toStrictEqual(['No app compilation inputs found for Debug. Run the matching app tests first.']);
});

test('deduplicates keys and sorts diagnostics', t => {
  const f = fixture(t);
  f.extract(['z', 'a', 'z']);
  f.extract(['a', 'z'], 'Localizable', f.source, f.output);
  f.write(path.join(f.output, 'Duplicate.stringsdata'), {
    source: f.source,
    tables: { Localizable: [{ key: 'z' }, { key: 'a' }] },
  });
  f.catalog({});
  expect(f.check()).toStrictEqual([`${label}: missing key 'a'.`, `${label}: missing key 'z'.`]);
});

test('fails on filesystem errors', t => {
  const f = fixture(t);
  expect(() => checkCatalogs(f.app, path.join(f.root, 'missing'), 'Debug')).toThrow(/ENOENT/);
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return childProcess.spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, ...env },
  });
}

for (const arg of ['--help', '-h']) {
  test(`CLI ${arg} works without Xcode`, () => {
    const result = cli([arg], { PATH: '' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage:/);
    expect(result.stderr).toBe('');
  });
}

for (const args of [[], ['linux'], ['macos', 'ios'], ['--help', 'macos']]) {
  test(`CLI rejects ${JSON.stringify(args)} without Xcode`, () => {
    const result = cli(args, { PATH: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Cannot verify localization coverage: Expected exactly one platform/);
  });
}

function fakeXcode(t: TestContext, body: string) {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(f.root, 'arguments.json');
  fs.writeFileSync(
    path.join(bin, 'xcodebuild'),
    `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n${body}\n`,
    { mode: 0o755 },
  );

  return { ...f, log, env: { PATH: bin } };
}

for (const { platform, configuration, destination } of [
  { platform: 'macos', configuration: 'Debug', destination: 'platform=macOS' },
  { platform: 'ios', configuration: 'Debug-iphonesimulator', destination: 'generic/platform=iOS Simulator' },
]) {
  test(`CLI selects TCG settings and ${platform} configuration`, t => {
    const f = fakeXcode(t, 'console.log(process.env.SETTINGS);');
    const source = path.join(repo, 'app/TCG/AbsentFixture.swift');
    const output = path.join(f.build, configuration);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'TCG.SwiftFileList'), quote(source) + '\n');
    f.write(path.join(output, 'TCG.stringsdata'), { source, tables: {} });

    const result = cli([platform], {
      ...f.env,
      SETTINGS: JSON.stringify([
        { target: 'Other', buildSettings: {} },
        { target: 'TCG', buildSettings: { CONFIGURATION: 'Debug', OBJROOT: f.build } },
      ]),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      `Localization catalogs cover all compiler-extracted ${platform} keys and declared translations.\n`,
    );
    expect(JSON.parse(fs.readFileSync(f.log, 'utf8'))).toStrictEqual([
      '-showBuildSettings',
      '-project',
      path.join(repo, 'app/TCG.xcodeproj'),
      '-scheme',
      'TCG',
      '-destination',
      destination,
      '-json',
      'CODE_SIGNING_ALLOWED=NO',
    ]);
  });
}

test('CLI reports coverage failure', t => {
  const f = fakeXcode(t, 'console.log(process.env.SETTINGS);');

  const result = cli(['macos'], {
    ...f.env,
    SETTINGS: JSON.stringify([{ target: 'TCG', buildSettings: { CONFIGURATION: 'Release', OBJROOT: f.build } }]),
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    "Localization coverage failed:\n  No app compilation inputs found for Release. Run the matching app tests first.\nSync catalogs from Xcode's extracted .stringsdata; see app/README.md.\n",
  );
});

for (const output of ['not JSON', '{}', '[]', '[{"target":"TCG","buildSettings":{}}]']) {
  test(`CLI fails closed on build settings ${output}`, t => {
    const f = fakeXcode(t, `console.log(${JSON.stringify(output)});`);
    const result = cli(['macos'], f.env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Cannot verify localization coverage:/);
  });
}

test('CLI reports subprocess errors', t => {
  const f = fakeXcode(t, 'console.error("discovery failed"); process.exit(7);');
  const result = cli(['ios'], f.env);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^Cannot verify localization coverage:/);
  expect(result.stderr).toMatch(/discovery failed/);
});

test('CLI reports unavailable xcodebuild', () => {
  const result = cli(['macos'], { PATH: '' });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^Cannot verify localization coverage:.*ENOENT/);
});

test('checks absent sources in empty module directories', t => {
  const f = fixture(t);
  fs.unlinkSync(f.source);
  f.catalog({ 'How to search': {} });
  expect(f.check()).toStrictEqual([]);
});

test('rejects malformed catalog JSON', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.owner, 'Localizable.xcstrings'), 'not JSON');
  expect(f.check).toThrow(SyntaxError);
});

test('treats shell expansions as literal source paths', t => {
  const f = fixture(t);
  const source = path.join(f.owner, '$(touch sentinel).swift');
  fs.writeFileSync(f.fileList, quote(source) + '\n');
  f.extract(['How to search'], 'Localizable', source);
  f.catalog({ 'How to search': {} });
  expect(f.check()).toStrictEqual([]);
  expect(fs.existsSync(path.join(f.root, 'sentinel'))).toBe(false);
});
