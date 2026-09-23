import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

interface WorktreePorts {
  app: number;
  db: number;
  storage: number;
}

function run(command: string, args: string[], options: { stdio?: 'inherit' } = {}): string {
  const result = childProcess.spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', ...options });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }

  return result.stdout ?? '';
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

function requireLocalURL(value: string | undefined, name: string): URL {
  if (!value) {
    throw new Error(`${name} is required in .env`);
  }

  const url = new URL(value);

  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} must use localhost for per-worktree port allocation`);
  }

  return url;
}

function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value ?? fallback);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid local port: ${value}`);
  }

  return port;
}

export function worktreeEnv(source: string, { app, db, storage }: WorktreePorts, branch: string): string {
  const values = valuesFromEnv(source);
  const databaseURL = requireLocalURL(values.get('DATABASE_URL'), 'DATABASE_URL');
  const authURL = requireLocalURL(values.get('BETTER_AUTH_URL'), 'BETTER_AUTH_URL');
  const storageURL = requireLocalURL(values.get('OBJECT_STORAGE_ENDPOINT'), 'OBJECT_STORAGE_ENDPOINT');
  databaseURL.port = String(db);
  authURL.port = String(app);
  storageURL.port = String(storage);

  const replacements = new Map([
    ['PORT', String(app)],
    ['DATABASE_URL', databaseURL.toString()],
    ['BETTER_AUTH_URL', authURL.toString()],
    ['OBJECT_STORAGE_ENDPOINT', storageURL.toString()],
    ['TCG_DB_PORT', String(db)],
    ['TCG_STORAGE_PORT', String(storage)],
    ['COMPOSE_PROJECT_NAME', `tcg-wt-${crypto.createHash('sha256').update(branch).digest('hex').slice(0, 12)}`],
  ]);

  const publicBaseURL = values.get('PUBLIC_BASE_URL');

  if (publicBaseURL !== undefined) {
    const publicURL = new URL(publicBaseURL);

    if (['localhost', '127.0.0.1', '[::1]'].includes(publicURL.hostname)) {
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

function worktreePaths(): string[] {
  return run('git', ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length));
}

async function reservedPorts(): Promise<Set<number>> {
  const reserved = new Set<number>();

  for (const worktreePath of worktreePaths()) {
    let values: Map<string, string>;

    try {
      values = valuesFromEnv(await fs.readFile(path.join(worktreePath, '.env'), 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }

      throw error;
    }

    reserved.add(portFrom(values.get('PORT'), 8080));
    reserved.add(portFrom(values.get('TCG_DB_PORT'), 5432));
    reserved.add(portFrom(values.get('TCG_STORAGE_PORT'), 9000));
  }

  return reserved;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)));
  });
}

async function availablePorts(): Promise<WorktreePorts> {
  const reserved = await reservedPorts();

  for (let offset = 0; offset < 900; offset++) {
    const ports = { app: 8100 + offset, db: 5500 + offset, storage: 9100 + offset };
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
  const branch = process.argv[2];

  if (!branch || process.argv.length !== 3) {
    throw new Error('Usage: just herdr-worktree <new-branch>');
  }

  run('git', ['check-ref-format', '--branch', branch]);

  const existing = childProcess.spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoRoot,
  });

  if (existing.error) {
    throw existing.error;
  }

  if (existing.status === 0) {
    throw new Error(`Branch ${branch} already exists`);
  }

  if (existing.status !== 1) {
    throw new Error('Could not check whether the branch exists');
  }

  const sourcePath = path.join(repoRoot, '.env');
  const source = await fs.readFile(sourcePath, 'utf8');
  const sourceMode = (await fs.stat(sourcePath)).mode & 0o777;
  const ports = await availablePorts();
  const contents = worktreeEnv(source, ports, branch);

  run('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });
  run('herdr', ['worktree', 'create', '--cwd', repoRoot, '--branch', branch, '--base', 'origin/main', '--no-focus']);

  const checkout = worktreePaths().find(path => {
    const result = childProcess.spawnSync('git', ['-C', path, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    });

    return result.status === 0 && result.stdout.trim() === branch;
  });

  if (!checkout) {
    throw new Error(`Herdr created ${branch}, but its checkout was not found`);
  }

  await fs.writeFile(path.join(checkout, '.env'), contents, { flag: 'wx', mode: sourceMode });
  console.log(`Created ${checkout} with app, database, and storage ports ${ports.app}, ${ports.db}, ${ports.storage}`);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
