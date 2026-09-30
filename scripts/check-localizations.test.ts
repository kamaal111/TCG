import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkCatalogs, translated, type JSONValue } from './check-localizations.ts';

const script = fileURLToPath(new URL('./check-localizations.ts', import.meta.url));

const repo = path.dirname(path.dirname(script));

const label = 'Modules/Features/Sources/Search/Localizable.xcstrings';

const unit = (state = 'translated', value = 'Zoekhulp') => ({ stringUnit: { state, value } });

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localizations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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

void test('accepts source-language fallback', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  assert.deepEqual(f.check(), []);
});

void test('reports missing catalogs', t => {
  const f = fixture(t);
  assert.deepEqual(f.check(), [`${label}: missing string catalog (1 extracted keys).`]);
});

void test('reports missing keys', t => {
  const f = fixture(t);
  f.catalog({});
  assert.deepEqual(f.check(), [`${label}: missing key 'How to search'.`]);
});

void test('isolates catalog ownership', t => {
  const f = fixture(t);
  const other = path.join(f.app, 'Modules/Other/Sources/Other');
  fs.mkdirSync(other, { recursive: true });
  f.write(path.join(other, 'Localizable.xcstrings'), { sourceLanguage: 'en', strings: { 'How to search': {} } });
  assert.deepEqual(f.check(), [`${label}: missing string catalog (1 extracted keys).`]);
});

void test('checks iOS extraction independently', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  const ios = f.output.replace('/Debug/', '/Debug-iphonesimulator/');
  fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(ios, 'Search.SwiftFileList'), quote(f.source) + '\n');
  f.extract(['How to search', 'Done'], 'Localizable', f.source, ios);
  assert.deepEqual(f.check('Debug-iphonesimulator'), [`${label}: missing key 'Done'.`]);
  assert.deepEqual(f.check(), []);
});

void test('reports disabled compiler extraction', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.output, 'Screen.stringsdata'));
  assert.deepEqual(f.check(), [
    'Modules/Features/Sources/Search/Screen.swift: no compiler string extraction; enable SWIFT_EMIT_LOC_STRINGS.',
  ]);
});

void test('reports absent compilation inputs', t => {
  const f = fixture(t);
  fs.unlinkSync(f.fileList);
  assert.deepEqual(f.check(), ['No app compilation inputs found for Debug. Run the matching app tests first.']);
});

void test('honors custom tables', t => {
  const f = fixture(t);
  f.extract(['How to search'], 'Help');
  f.catalog({ 'How to search': {} }, 'Help');
  assert.deepEqual(f.check(), []);
});

void test('excludes dependencies and nonlocalizable literals', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  f.extract(['Dependency key'], 'Localizable', path.join(f.root, 'dependency/External.swift'));
  fs.writeFileSync(f.source, 'Text("How to search"); Text(verbatim: "sv5m 072/071")');
  assert.deepEqual(f.check(), []);
});

void test('requires completed declared translations', t => {
  const f = fixture(t);
  f.extract(['How to search', 'Done']);
  f.catalog({
    'How to search': { localizations: { nl: unit() } },
    Done: { localizations: { nl: unit('needs_review') } },
  });
  assert.deepEqual(f.check(), [`${label}: 'Done' has no completed nl translation.`]);
});

void test('accepts translation exemptions', t => {
  const f = fixture(t);
  f.extract(['How to search', 'TCG']);
  f.catalog({ 'How to search': { localizations: { nl: unit() } }, TCG: { shouldTranslate: false } });
  assert.deepEqual(f.check(), []);
});

void test('collects languages repository-wide and excludes each source language', t => {
  const f = fixture(t);
  f.catalog({ 'How to search': {} });
  f.write(path.join(f.app, 'Other.xcstrings'), {
    sourceLanguage: 'nl',
    strings: { Other: { localizations: { en: unit(), fr: unit() } } },
  });
  assert.deepEqual(f.check(), [`${label}: 'How to search' has no completed fr translation.`]);
});

void test('requires every plural variant', () => {
  assert.equal(translated({ variations: { plural: { one: unit(), other: unit('new') } } }), false);
});

void test('accepts completed plural variants', () => {
  assert.equal(translated({ variations: { plural: { one: unit(), other: unit() } } }), true);
});

void test('requires completed substitution variants', () => {
  assert.equal(
    translated({ ...unit(), substitutions: { count: { variations: { plural: { other: unit('new') } } } } }),
    false,
  );
});

void test('accepts completed substitution variants', () => {
  assert.equal(
    translated({ ...unit(), substitutions: { count: { variations: { plural: { other: unit() } } } } }),
    true,
  );
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
  void test(`rejects incomplete translation ${JSON.stringify(value)}`, () => {
    assert.equal(translated(value), false);
  });
}

for (const value of ['not JSON', '{}', '{"source":1,"tables":{}}', '{"source":"x","tables":[]}']) {
  void test(`rejects malformed extraction ${value}`, t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.output, 'Screen.stringsdata'), value);
    assert.throws(f.check);
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
  void test(`rejects malformed catalog ${JSON.stringify(value)}`, t => {
    const f = fixture(t);
    f.write(path.join(f.owner, 'Localizable.xcstrings'), value);
    assert.throws(f.check);
  });
}

for (const table of ['', '.', '..', '../Other', '/Other']) {
  void test(`rejects invalid table ${JSON.stringify(table)}`, t => {
    const f = fixture(t);
    f.extract(['x'], table);
    assert.throws(f.check, /Invalid localization table/);
  });
}

void test('rejects non-string extracted keys', t => {
  const f = fixture(t);
  f.extract([1]);
  assert.throws(f.check, /Invalid localization key/);
});

void test('rejects malformed table entries', t => {
  const f = fixture(t);
  f.write(path.join(f.output, 'Screen.stringsdata'), { source: f.source, tables: { Localizable: {} } });
  assert.throws(f.check, /Invalid localization entries/);
});

for (const name of ['Screen with spaces.swift', "Screen'quote.swift", 'Screen"quote.swift', 'Screen\\slash.swift']) {
  void test(`parses shell quoted path ${name}`, t => {
    const f = fixture(t);
    const source = path.join(f.owner, name);
    fs.writeFileSync(f.fileList, quote(source) + '\n');
    f.extract(['How to search'], 'Localizable', source);
    f.catalog({ 'How to search': {} });
    assert.deepEqual(f.check(), []);
  });
}

void test('parses double quotes and backslash escapes', t => {
  const f = fixture(t);
  const source = path.join(f.owner, 'Screen "with" \\spaces.swift');
  fs.writeFileSync(
    f.fileList,
    '"' + source.replace(/(["\\])/g, '\\$1') + '"\n' + source.replace(/([\s"\\])/g, '\\$1') + '\n',
  );
  f.extract(['How to search'], 'Localizable', source);
  f.catalog({ 'How to search': {} });
  assert.deepEqual(f.check(), []);
});

for (const entry of ['', 'two paths', "'unterminated", 'dangling\\', "''"]) {
  void test(`rejects invalid file-list entry ${JSON.stringify(entry)}`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.fileList, entry + '\n');
    assert.throws(f.check, /Invalid Swift file list entry/);
  });
}

void test('does not claim sources in sibling directories', t => {
  const f = fixture(t);
  const sibling = path.join(f.app, 'TCGSibling', 'Screen.swift');
  fs.mkdirSync(path.dirname(sibling));
  fs.writeFileSync(f.fileList, quote(sibling) + '\n');
  f.extract(['x'], 'Localizable', sibling);
  assert.deepEqual(f.check(), ['No app compilation inputs found for Debug. Run the matching app tests first.']);
});

void test('deduplicates keys and sorts diagnostics', t => {
  const f = fixture(t);
  f.extract(['z', 'a', 'z']);
  f.extract(['a', 'z'], 'Localizable', f.source, f.output);
  f.write(path.join(f.output, 'Duplicate.stringsdata'), {
    source: f.source,
    tables: { Localizable: [{ key: 'z' }, { key: 'a' }] },
  });
  f.catalog({});
  assert.deepEqual(f.check(), [`${label}: missing key 'a'.`, `${label}: missing key 'z'.`]);
});

void test('fails on filesystem errors', t => {
  const f = fixture(t);
  assert.throws(() => checkCatalogs(f.app, path.join(f.root, 'missing'), 'Debug'), /ENOENT/);
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, ...env },
  });
}

for (const arg of ['--help', '-h']) {
  void test(`CLI ${arg} works without Xcode`, () => {
    const result = cli([arg], { PATH: '' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.equal(result.stderr, '');
  });
}

for (const args of [[], ['linux'], ['macos', 'ios'], ['--help', 'macos']]) {
  void test(`CLI rejects ${JSON.stringify(args)} without Xcode`, () => {
    const result = cli(args, { PATH: '' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Cannot verify localization coverage: Expected exactly one platform/);
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
  void test(`CLI selects TCG settings and ${platform} configuration`, t => {
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

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `Localization catalogs cover all compiler-extracted ${platform} keys and declared translations.\n`,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(f.log, 'utf8')), [
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

void test('CLI reports coverage failure', t => {
  const f = fakeXcode(t, 'console.log(process.env.SETTINGS);');

  const result = cli(['macos'], {
    ...f.env,
    SETTINGS: JSON.stringify([{ target: 'TCG', buildSettings: { CONFIGURATION: 'Release', OBJROOT: f.build } }]),
  });

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Localization coverage failed:\n  No app compilation inputs found for Release. Run the matching app tests first.\nSync catalogs from Xcode's extracted .stringsdata; see app/README.md.\n",
  );
});

for (const output of ['not JSON', '{}', '[]', '[{"target":"TCG","buildSettings":{}}]']) {
  void test(`CLI fails closed on build settings ${output}`, t => {
    const f = fakeXcode(t, `console.log(${JSON.stringify(output)});`);
    const result = cli(['macos'], f.env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Cannot verify localization coverage:/);
  });
}

void test('CLI reports subprocess errors', t => {
  const f = fakeXcode(t, 'console.error("discovery failed"); process.exit(7);');
  const result = cli(['ios'], f.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Cannot verify localization coverage:/);
  assert.match(result.stderr, /discovery failed/);
});

void test('CLI reports unavailable xcodebuild', () => {
  const result = cli(['macos'], { PATH: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Cannot verify localization coverage:.*ENOENT/);
});

void test('checks absent sources in empty module directories', t => {
  const f = fixture(t);
  fs.unlinkSync(f.source);
  f.catalog({ 'How to search': {} });
  assert.deepEqual(f.check(), []);
});

void test('rejects malformed catalog JSON', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.owner, 'Localizable.xcstrings'), 'not JSON');
  assert.throws(f.check, SyntaxError);
});

void test('treats shell expansions as literal source paths', t => {
  const f = fixture(t);
  const source = path.join(f.owner, '$(touch sentinel).swift');
  fs.writeFileSync(f.fileList, quote(source) + '\n');
  f.extract(['How to search'], 'Localizable', source);
  f.catalog({ 'How to search': {} });
  assert.deepEqual(f.check(), []);
  assert.equal(fs.existsSync(path.join(f.root, 'sentinel')), false);
});
