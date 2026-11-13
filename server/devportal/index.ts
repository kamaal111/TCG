import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { type ServerType, serve } from '@hono/node-server';
import { configureLogging } from '@tcg/http/logging';
import { createNodeLogger } from '@tcg/http/node-logging';
import { registerNodeServerShutdown } from '@tcg/http/node-server-lifecycle';

import { createDevportalApp } from './app.ts';
import { readPortalSettings } from './config.ts';
import { inspectApp, inspectServer } from './inspection.ts';
import { logReleaseTransition } from './logging.ts';
import { ReleaseSessions } from './sessions.ts';
import { requireWebBundle, webRoot } from './web.ts';
import { runAppRelease } from '../../scripts/app-release/runtime.ts';
import { acquireLocalLease } from '../../scripts/release/lock.ts';
import { runReleaseRuntime } from '../../scripts/release/runtime.ts';

process.umask(0o077);

const root = url.fileURLToPath(new URL('../../', import.meta.url));
const configDirectory = process.env.TCG_CONFIG_DIRECTORY ?? path.join(os.homedir(), '.config/tcg');

await requireWebBundle();

const config = await readPortalSettings(configDirectory);
const releaseServiceLease = await acquireLocalLease(configDirectory, 'devportal');

const logger = createNodeLogger({ service: 'mintomo-devportal', mode: 'SERVER' });

configureLogging({ root: logger, createRequestLogger: fields => logger.child(fields) });

let server: ServerType | undefined;

const appCancellation = new AbortController();

const sessions = new ReleaseSessions({
  directory: path.join(configDirectory, 'devportal-releases'),
  configDirectory,
  transitioned: logReleaseTransition,
  inspectApp: (platform, page) => inspectApp({ root, configDirectory }, platform, page),
  runApp: options => runAppRelease({ ...options, root, configDirectory, signal: appCancellation.signal }),
  inspect: page => inspectServer({ root, configDirectory }, page),
  run: options => runReleaseRuntime({ ...options, root, configDirectory, mode: 'application' }),
});

await sessions.initialize();

registerNodeServerShutdown({
  server: () => server,
  dispose: async () => {
    appCancellation.abort();
    await sessions.shutdownApp();
    await releaseServiceLease();
  },
});

const app = createDevportalApp(sessions, config.allowedLogins, webRoot);

server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port });
