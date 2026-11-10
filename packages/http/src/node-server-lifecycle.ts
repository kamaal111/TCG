import { serverLogger } from './server-logging.ts';

export const SERVER_SHUTDOWN_TIMEOUT_MS = 10_000;

interface ShutdownOptions {
  server: () => { close(callback: (error?: Error) => void): void } | undefined;
  stop?: () => void;
  dispose: () => Promise<void>;
}

/** Owns process termination, HTTP draining and resource disposal for Node services. */
export function registerNodeServerShutdown(options: ShutdownOptions): void {
  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    const logger = serverLogger();
    logger.info({ event: 'server.shutdown.started', signal, outcome: 'success' }, 'Shutting the HTTP server down.');

    const timeout = setTimeout(() => {
      logger.warn(
        { event: 'server.shutdown.forced', outcome: 'failure', error_code: 'SHUTDOWN_TIMEOUT' },
        'Forced the HTTP server down after it did not close in time.',
      );
      process.exit(1);
    }, SERVER_SHUTDOWN_TIMEOUT_MS);

    try {
      options.stop?.();
      const server = options.server();

      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
        });
      }

      await options.dispose();
      logger.info({ event: 'server.shutdown.completed', outcome: 'success' }, 'Shut the HTTP server down.');
      clearTimeout(timeout);
      process.exit(0);
    } catch {
      logger.error(
        { event: 'server.shutdown.forced', outcome: 'failure', error_code: 'SHUTDOWN_FAILED' },
        'Could not finish shutting the HTTP server down.',
      );
      clearTimeout(timeout);
      process.exit(1);
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}
