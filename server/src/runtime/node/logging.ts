import stream from 'node:stream';

import type { ServerMode } from '@tcg/http/common';
import { configureLogging } from '@tcg/http/logging';
import { createNodeLogger } from '@tcg/http/node-logging';
import type { DestinationStream, LevelWithSilent, Logger } from 'pino';

import { LoggingEnvSchema } from '../../config.ts';

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
  const logger = createServerLogger({ destination });
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
  const env = LoggingEnvSchema.parse(process.env);

  return createNodeLogger({
    service: SERVICE_NAME,
    mode: options.mode ?? env.MODE,
    level: options.level ?? env.LOG_LEVEL,
    pretty: options.pretty ?? env.DEBUG,
    destination: options.destination,
  });
}
