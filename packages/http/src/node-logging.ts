import pino from 'pino';
import type { DestinationStream, LevelWithSilent } from 'pino';

import type { ServerMode } from './common.ts';

export function createNodeLogger(options: {
  service: string;
  mode: ServerMode;
  level?: LevelWithSilent;
  pretty?: boolean;
  destination?: DestinationStream;
}) {
  const destination =
    options.destination ??
    (options.pretty
      ? pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } })
      : pino.destination({ sync: true }));

  return pino(
    {
      level: options.level ?? 'info',
      base: { service: options.service, mode: options.mode },
      redact: {
        paths: ['authorization', 'Authorization', 'cookie', 'Cookie', 'token', 'jwt', 'password', 'email'],
        censor: '[Redacted]',
      },
    },
    destination,
  );
}
