/** Compare Xcode's compiler-extracted keys with the app's string catalogs. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type JSONValue = string | number | boolean | null | JSONValue[] | JSONObject;

interface JSONObject {
  [key: string]: JSONValue;
}

function isJSON(value: unknown): value is JSONValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) ? value.every(isJSON) : record(value))
  );
}

function record<Input>(value: Input): value is Input & JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(isJSON);
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

function readJSON(file: string): JSONValue {
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!isJSON(value)) {
    throw new Error(`Invalid JSON in ${file}`);
  }

  return value;
}

function files(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap(entry => {
      const file = path.join(root, entry.name);

      return entry.isDirectory() ? files(file) : [file];
    })
    .sort();
}

function contains(root: string, file: string): boolean {
  const relative = path.relative(root, file);

  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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
  if (!record(value)) {
    return false;
  }

  if ('stringUnit' in value) {
    const unit = value.stringUnit;

    if (!record(unit) || unit.state !== 'translated' || !isString(unit.value)) {
      return false;
    }

    const substitutions = 'substitutions' in value ? value.substitutions : {};

    return record(substitutions) && Object.values(substitutions).every(translated);
  }

  const variations = value.variations;

  return (
    record(variations) &&
    Object.keys(variations).length > 0 &&
    Object.values(variations).every(
      cases => record(cases) && Object.keys(cases).length > 0 && Object.values(cases).every(translated),
    )
  );
}

interface Catalog {
  sourceLanguage: string;
  strings: JSONObject;
}

function parseCatalog(value: JSONValue): Catalog {
  const data = object(value);
  const sourceLanguage = string(data.sourceLanguage);
  const strings = object(data.strings);

  for (const entry of Object.values(strings)) {
    const item = object(entry);

    if ('shouldTranslate' in item && item.shouldTranslate !== true && item.shouldTranslate !== false) {
      throw new Error('Invalid shouldTranslate');
    }

    if ('localizations' in item) {
      object(item.localizations);
    }
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

  const sourceOwner = (source: string) => [...owners].find(owner => contains(owner, source));
  const catalogs = new Map<string, Catalog>();
  const languages = new Set<string>();

  for (const file of appFiles.filter(file => file.endsWith('.xcstrings'))) {
    const catalog = parseCatalog(readJSON(file));
    catalogs.set(file, catalog);

    for (const entry of Object.values(catalog.strings)) {
      for (const language of Object.keys(object(object(entry).localizations ?? {}))) {
        if (language !== catalog.sourceLanguage) {
          languages.add(language);
        }
      }
    }
  }

  const buildFiles = files(buildRoot).filter(file => file.split(path.sep).includes(configuration));
  const expectedSources = new Set<string>();
  const extractedSources = new Set<string>();

  for (const file of buildFiles.filter(file => file.endsWith('.SwiftFileList'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    if (lines.at(-1) === '') {
      lines.pop();
    }

    for (const line of lines) {
      const source = parseFileListEntry(line, file);

      if (sourceOwner(source)) {
        expectedSources.add(source);
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
    const owner = sourceOwner(source);

    if (!expectedSources.has(source) || !owner) {
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

  const errors = [...expectedSources]
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

    for (const key of [...keys].sort()) {
      if (!Object.hasOwn(catalog.strings, key)) {
        errors.push(`${label}: missing key ${repr(key)}.`);
        continue;
      }

      const entry = object(catalog.strings[key]);

      if (entry.shouldTranslate === false) {
        continue;
      }

      for (const language of [...languages].sort().filter(language => language !== catalog.sourceLanguage)) {
        if (!translated(object(entry.localizations ?? {})[language])) {
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

  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

  const result = execFileSync(
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

  const data: unknown = JSON.parse(result);

  if (!Array.isArray(data)) {
    throw new Error('Invalid build settings');
  }

  const target = data
    .map(item => {
      if (!isJSON(item)) {
        throw new Error('Invalid build settings');
      }

      return object(item);
    })
    .find(item => item.target === 'TCG');

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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Cannot verify localization coverage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
