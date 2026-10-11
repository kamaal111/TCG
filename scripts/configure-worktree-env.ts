import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';

interface WorktreePorts {
  app: number;
  db: number;
  storage: number;
}

const portSettings = {
  app: { key: 'PORT', fallback: 8080, allocationStart: 8100 },
  db: { key: 'TCG_DB_PORT', fallback: 5432, allocationStart: 5500 },
  storage: { key: 'TCG_STORAGE_PORT', fallback: 9000, allocationStart: 9100 },
};

function isLocalURL(value: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname);
}

function portsFromEnv(values: Map<string, string>): WorktreePorts {
  const read = (setting: { key: string; fallback: number }) => portFrom(values.get(setting.key), setting.fallback);

  return { app: read(portSettings.app), db: read(portSettings.db), storage: read(portSettings.storage) };
}

function valuesFromEnv(contents: string): Map<string, string> {
  return contents.split(/\r?\n/).reduce((values, line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    const key = match?.[1];
    const value = match?.[2];

    if (key === undefined || value === undefined) {
      return values;
    }

    return values.set(key, value);
  }, new Map<string, string>());
}

function parseURL(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${name} URL in .env`);
  }
}

function requireLocalURL(value: string | undefined, name: string): URL {
  if (!value) {
    throw new Error(`${name} is required in .env`);
  }

  const url = parseURL(value, name);

  if (!isLocalURL(url)) {
    throw new Error(`${name} must use localhost for per-worktree port allocation`);
  }

  return url;
}

function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value ?? fallback);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid local port in .env');
  }

  return port;
}

export function worktreeEnv(source: string, { app, db, storage }: WorktreePorts, project: string): string {
  const values = valuesFromEnv(source);
  const databaseURL = requireLocalURL(values.get('DATABASE_URL'), 'DATABASE_URL');
  const authURL = requireLocalURL(values.get('BETTER_AUTH_URL'), 'BETTER_AUTH_URL');
  const storageURL = requireLocalURL(values.get('OBJECT_STORAGE_ENDPOINT'), 'OBJECT_STORAGE_ENDPOINT');
  databaseURL.port = String(db);
  authURL.port = String(app);
  storageURL.port = String(storage);

  const replacements = new Map([
    [portSettings.app.key, String(app)],
    ['DATABASE_URL', databaseURL.toString()],
    ['BETTER_AUTH_URL', authURL.toString()],
    ['OBJECT_STORAGE_ENDPOINT', storageURL.toString()],
    [portSettings.db.key, String(db)],
    [portSettings.storage.key, String(storage)],
    ['COMPOSE_PROJECT_NAME', project],
  ]);

  const publicBaseURL = values.get('PUBLIC_BASE_URL');

  if (publicBaseURL !== undefined) {
    const publicURL = parseURL(publicBaseURL, 'PUBLIC_BASE_URL');

    if (isLocalURL(publicURL)) {
      publicURL.port = String(app);
      replacements.set('PUBLIC_BASE_URL', publicURL.toString());
    }
  }

  const seen = new Set<string>();

  const lines = source
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map(line => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);

      const key = match?.[1];

      if (key === undefined || !replacements.has(key)) {
        return line;
      }

      if (seen.has(key)) {
        throw new Error(`Duplicate ${key} in .env`);
      }

      seen.add(key);

      return `${key}=${replacements.get(key)}`;
    });

  for (const [key, value] of replacements) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function reservations(paths: string[]): Promise<{ ports: Set<number>; projects: Set<string> }> {
  const ports = new Set<number>();
  const projects = new Set<string>();

  for (const checkout of paths) {
    let values: Map<string, string>;

    try {
      values = valuesFromEnv(await fs.readFile(path.join(checkout, '.env'), 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }

      throw error;
    }

    for (const port of Object.values(portsFromEnv(values))) {
      ports.add(port);
    }

    for (const key of ['DATABASE_URL', 'OBJECT_STORAGE_ENDPOINT', 'BETTER_AUTH_URL']) {
      const value = values.get(key);

      if (value) {
        const service = parseURL(value, key);

        if (isLocalURL(service)) {
          let fallback = service.protocol === 'https:' ? 443 : 80;

          if (key === 'DATABASE_URL') {
            fallback = portSettings.db.fallback;
          }

          ports.add(portFrom(service.port || undefined, fallback));
        }
      }
    }

    const project = values.get('COMPOSE_PROJECT_NAME');

    if (project) {
      projects.add(project);
    }
  }

  return { ports, projects };
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)));
  });
}

async function availablePorts(reserved: Set<number>): Promise<WorktreePorts> {
  for (let offset = 0; offset < 900; offset++) {
    const ports = {
      app: portSettings.app.allocationStart + offset,
      db: portSettings.db.allocationStart + offset,
      storage: portSettings.storage.allocationStart + offset,
    };

    const candidates = Object.values(ports);

    if (candidates.some(port => reserved.has(port))) {
      continue;
    }

    if ((await Promise.all(candidates.map(portIsFree))).every(Boolean)) {
      return ports;
    }
  }

  throw new Error('No free port set available for a new worktree');
}

async function main(): Promise<void> {
  const [root, sourcePath, destination, ...peers] = process.argv.slice(2);

  if (!root || !sourcePath || !destination) {
    throw new Error('Run just setup-worktree to prepare the environment before allocating ports');
  }

  const source = await fs.readFile(destination, 'utf8');
  const envPath = path.join(root, '.env');
  const reserved = await reservations(peers);
  const values = valuesFromEnv(source);
  const project = values.get('COMPOSE_PROJECT_NAME');

  const current = portsFromEnv(values);

  const normalized = worktreeEnv(source, current, project ?? 'tcg-wt-validation');
  const complete = Object.values(portSettings).every(({ key }) => values.has(key));

  if (
    sourcePath === envPath &&
    project &&
    complete &&
    !reserved.projects.has(project) &&
    new Set(Object.values(current)).size === 3 &&
    Object.values(current).every(port => !reserved.ports.has(port))
  ) {
    const normalizedValues = valuesFromEnv(normalized);

    if ([...normalizedValues].every(([key, value]) => values.get(key) === value)) {
      console.log(`Worktree already configured: ${root} (ports ${current.app}, ${current.db}, ${current.storage})`);

      return;
    }
  }

  const ports = await availablePorts(reserved.ports);
  const name = `tcg-wt-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 12)}`;

  if (reserved.projects.has(name)) {
    throw new Error('Generated Compose project name is already reserved by another worktree');
  }

  const contents = worktreeEnv(source, ports, name);
  await fs.writeFile(destination, contents);
  console.log(`Configured ${root} with app, database, and storage ports ${ports.app}, ${ports.db}, ${ports.storage}`);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Worktree setup failed');
    process.exitCode = 1;
  });
}
