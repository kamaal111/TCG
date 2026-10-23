import stream from 'node:stream';

import type { DestinationStream, LevelWithSilent, Logger, LoggerOptions } from 'pino';
import pino from 'pino';

import type { ServerMode } from '../../constants/common.ts';
import env from '../../env.ts';
import { configureLogging } from '../../logging/index.ts';

const SERVICE_NAME = 'tcg-server';

interface CreateLoggerOptions {
  destination?: DestinationStream;
  level?: LevelWithSilent;
  mode?: ServerMode;
  pretty?: boolean;
}

let rootLogger: Logger | undefined;

export function initializeNodeLogging() {
  if (rootLogger == null) {
    setRootLoggerDestination();
  }
}

export function setRootLoggerDestination(destination?: DestinationStream) {
  const logger = createServerLogger({ destination, pretty: destination == null ? env.DEBUG : false });
  rootLogger = logger;
  configureLogging({ root: logger, createRequestLogger: fields => logger.child(fields) });
}

export function createMemoryLogDestination(logs: string[]) {
  return new stream.Writable({
    write(chunk: string | Uint8Array, _encoding, callback) {
      logs.push(Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });
}

function createServerLogger(options: CreateLoggerOptions = {}): Logger {
  const destination = options.destination ?? createDestination(options.pretty ?? env.DEBUG);
  const loggerOptions = createLoggerOptions(options.level ?? env.LOG_LEVEL, options.mode ?? env.MODE);

  return pino(loggerOptions, destination);
}

function createLoggerOptions(level: LevelWithSilent, mode: ServerMode): LoggerOptions {
  return {
    level,
    base: { service: SERVICE_NAME, mode },
    redact: {
      paths: ['authorization', 'Authorization', 'cookie', 'Cookie', 'token', 'jwt', 'password', 'email'],
      censor: '[Redacted]',
    },
  };
}

function createDestination(pretty: boolean) {
  if (pretty) {
    return pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } });
  }

  return pino.destination({ sync: true });
}
