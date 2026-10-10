/** Compare Xcode's compiler-extracted keys with the app's string catalogs. */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export type JSONValue = string | number | boolean | null | JSONValue[] | JSONObject;

interface JSONObject {
  [key: string]: JSONValue;
}

function isJSON(value: unknown): value is JSONValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) ? value.every(isJSON) : isObject(value) && Object.values(value).every(isJSON))
  );
}

function isObject<Input>(value: Input): value is Input & object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: JSONValue | undefined): value is JSONObject {
  return isObject(value);
}

function object(value: JSONValue | undefined): JSONObject {
  if (!record(value)) {
    throw new Error('Expected a JSON object');
  }

  return value;
}

function isString(value: JSONValue | undefined): value is string {
  return typeof value === 'string';
}

function string(value: JSONValue | undefined): string {
  if (!isString(value) || !value) {
    throw new Error('Expected a nonempty string');
  }

  return value;
}

function parseJSON(contents: string): JSONValue {
  const value: unknown = JSON.parse(contents);

  if (!isJSON(value)) {
    throw new Error('Invalid JSON value');
  }

  return value;
}

function readJSON(file: string): JSONValue {
  return parseJSON(fs.readFileSync(file, 'utf8'));
}

function files(root: string): string[] {
  const results: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(file);
      } else {
        results.push(file);
      }
    }
  }

  visit(root);

  return results.sort();
}

// Resolve existing ancestors so symlinks work without requiring compiler sources to still exist.
function resolveSource(file: string): string {
  const absolute = path.resolve(file);

  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }

    const parent = path.dirname(absolute);

    if (parent === absolute) {
      throw error;
    }

    return path.join(resolveSource(parent), path.basename(absolute));
  }
}

function parseFileListEntry(line: string, file: string): string {
  const words: string[] = [];
  let word = '';
  let active = false;
  let quote = '';

  for (let index = 0; index < line.length; index++) {
    const char = line[index];

    if (char === undefined) {
      break;
    }

    if (char === '\\' && quote !== "'") {
      const next = line[++index];

      if (next === undefined) {
        throw new Error(`Invalid Swift file list entry in ${file}: ${line}`);
      }

      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) {
        word += '\\';
      }

      word += next;
      active = true;
    } else if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        word += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (/\s/.test(char)) {
      if (active) {
        words.push(word);
      }

      word = '';
      active = false;
    } else {
      word += char;
      active = true;
    }
  }

  if (active) {
    words.push(word);
  }

  const source = words[0];

  if (quote || words.length !== 1 || !source || source.includes('\0')) {
    throw new Error(`Invalid Swift file list entry in ${file}: ${line}`);
  }

  return resolveSource(source);
}

export function translated(value: unknown): value is JSONObject {
  return isJSON(value) && completedTranslation(value);
}

function completedTranslation(value: JSONValue | undefined): boolean {
  if (!record(value)) {
    return false;
  }

  if ('stringUnit' in value) {
    const unit = value.stringUnit;

    if (!record(unit) || unit.state !== 'translated' || !isString(unit.value)) {
      return false;
    }

    const substitutions = 'substitutions' in value ? value.substitutions : {};

    return record(substitutions) && Object.values(substitutions).every(completedTranslation);
  }

  const variations = value.variations;

  return (
    record(variations) &&
    Object.keys(variations).length > 0 &&
    Object.values(variations).every(
      cases => record(cases) && Object.keys(cases).length > 0 && Object.values(cases).every(completedTranslation),
    )
  );
}

interface CatalogEntry {
  shouldTranslate: boolean;
  localizations: JSONObject;
}

interface Catalog {
  sourceLanguage: string;
  strings: Map<string, CatalogEntry>;
}

function parseCatalog(value: JSONValue): Catalog {
  const data = object(value);
  const sourceLanguage = string(data.sourceLanguage);
  const strings = new Map<string, CatalogEntry>();

  for (const [key, entry] of Object.entries(object(data.strings))) {
    const item = object(entry);

    if ('shouldTranslate' in item && item.shouldTranslate !== true && item.shouldTranslate !== false) {
      throw new Error('Invalid shouldTranslate');
    }

    strings.set(key, {
      shouldTranslate: item.shouldTranslate !== false,
      localizations: 'localizations' in item ? object(item.localizations) : {},
    });
  }

  return { sourceLanguage, strings };
}

function repr(key: string): string {
  const quote = key.includes("'") && !key.includes('"') ? '"' : "'";

  return (
    quote +
    key
      .replace(/\\/g, '\\\\')
      .replaceAll(quote, `\\${quote}`)
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    quote
  );
}

export function checkCatalogs(appRoot: string, buildRoot: string, configuration: string): string[] {
  appRoot = resolveSource(appRoot);
  const appFiles = files(appRoot);

  const owners = new Set([
    path.join(appRoot, 'TCG'),
    ...fs.globSync('Modules/*/Sources/*', { cwd: appRoot }).map(owner => path.join(appRoot, owner)),
  ]);

  const sourceOwner = (source: string) => {
    const parts = path.relative(appRoot, source).split(path.sep);
    const owner = path.join(appRoot, ...parts.slice(0, parts[0] === 'TCG' ? 1 : 4));

    return owners.has(owner) ? owner : undefined;
  };

  const catalogs = new Map<string, Catalog>();
  const languages = new Set<string>();

  for (const file of appFiles.filter(file => file.endsWith('.xcstrings'))) {
    const catalog = parseCatalog(readJSON(file));
    catalogs.set(file, catalog);

    for (const entry of catalog.strings.values()) {
      for (const language of Object.keys(entry.localizations)) {
        if (language !== catalog.sourceLanguage) {
          languages.add(language);
        }
      }
    }
  }

  const buildFiles = files(buildRoot).filter(file => file.split(path.sep).includes(configuration));
  const expectedSources = new Map<string, string>();
  const extractedSources = new Set<string>();

  for (const file of buildFiles.filter(file => file.endsWith('.SwiftFileList'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    if (lines.at(-1) === '') {
      lines.pop();
    }

    for (const line of lines) {
      const source = parseFileListEntry(line, file);

      const owner = sourceOwner(source);

      if (owner) {
        expectedSources.set(source, owner);
      }
    }
  }

  if (!expectedSources.size) {
    return [`No app compilation inputs found for ${configuration}. Run the matching app tests first.`];
  }

  const required = new Map<string, Set<string>>();

  for (const file of buildFiles.filter(file => file.endsWith('.stringsdata'))) {
    const data = object(readJSON(file));
    const source = resolveSource(string(data.source));
    const tables = object(data.tables);
    const owner = expectedSources.get(source);

    if (!owner) {
      continue;
    }

    extractedSources.add(source);

    for (const [table, entries] of Object.entries(tables)) {
      if (!table || table === '.' || table === '..' || path.basename(table) !== table || table.includes('\0')) {
        throw new Error(`Invalid localization table in ${file}: ${table}`);
      }

      if (!Array.isArray(entries)) {
        throw new Error(`Invalid localization entries in ${file}`);
      }

      const catalogPath = path.join(owner, `${table}.xcstrings`);
      const keys = required.get(catalogPath) ?? new Set<string>();

      for (const entry of entries) {
        const key = object(entry).key;

        if (!isString(key)) {
          throw new Error(`Invalid localization key in ${file}`);
        }

        keys.add(key);
      }

      required.set(catalogPath, keys);
    }
  }

  const declaredLanguages = [...languages].sort();

  const errors = [...expectedSources.keys()]
    .filter(source => !extractedSources.has(source))
    .sort()
    .map(source => `${path.relative(appRoot, source)}: no compiler string extraction; enable SWIFT_EMIT_LOC_STRINGS.`);

  for (const catalogPath of [...required.keys()].sort()) {
    const keys = required.get(catalogPath);

    if (!keys) {
      continue;
    }

    const label = path.relative(appRoot, catalogPath);
    const catalog = catalogs.get(catalogPath);

    if (!catalog) {
      errors.push(`${label}: missing string catalog (${keys.size} extracted keys).`);
      continue;
    }

    const requiredLanguages = declaredLanguages.filter(language => language !== catalog.sourceLanguage);

    for (const key of [...keys].sort()) {
      const entry = catalog.strings.get(key);

      if (!entry) {
        errors.push(`${label}: missing key ${repr(key)}.`);
        continue;
      }

      if (entry.shouldTranslate === false) {
        continue;
      }

      for (const language of requiredLanguages) {
        if (!completedTranslation(entry.localizations[language])) {
          errors.push(`${label}: ${repr(key)} has no completed ${language} translation.`);
        }
      }
    }
  }

  return errors;
}

function main(): number {
  const args = process.argv.slice(2);

  if (args.length === 1 && ['--help', '-h'].includes(args[0] ?? '')) {
    console.log(
      'Usage: check-localizations.ts <macos|ios>\nCompare Xcode compiler-extracted keys with string catalogs.',
    );

    return 0;
  }

  const platform = args[0];

  if (args.length !== 1 || (platform !== 'macos' && platform !== 'ios')) {
    throw new Error('Expected exactly one platform: macos or ios');
  }

  const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

  const result = childProcess.execFileSync(
    'xcodebuild',
    [
      '-showBuildSettings',
      '-project',
      path.join(root, 'app/TCG.xcodeproj'),
      '-scheme',
      'TCG',
      '-destination',
      platform === 'macos' ? 'platform=macOS' : 'generic/platform=iOS Simulator',
      '-json',
      'CODE_SIGNING_ALLOWED=NO',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const data = parseJSON(result);

  if (!Array.isArray(data)) {
    throw new Error('Invalid build settings');
  }

  const target = data.map(object).find(item => item.target === 'TCG');

  if (!target) {
    throw new Error('Missing TCG build settings');
  }

  const settings = object(target.buildSettings);
  const configuration = string(settings.CONFIGURATION) + (platform === 'ios' ? '-iphonesimulator' : '');
  const errors = checkCatalogs(path.join(root, 'app'), string(settings.OBJROOT), configuration);

  if (errors.length) {
    console.error('Localization coverage failed:');

    for (const error of errors) {
      console.error(`  ${error}`);
    }

    console.error("Sync catalogs from Xcode's extracted .stringsdata; see app/README.md.");

    return 1;
  }

  console.log(`Localization catalogs cover all compiler-extracted ${platform} keys and declared translations.`);

  return 0;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Cannot verify localization coverage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
