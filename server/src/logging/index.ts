import { Writable } from 'node:stream';

import pino from 'pino';
import type { DestinationStream, LevelWithSilent, Logger, LoggerOptions } from 'pino';

import env from '../env.ts';
import type { ServerMode } from '../constants/common.ts';

const SERVICE_NAME = 'tcg-server';
const DEFAULT_COMPONENT = 'server';
const REQUEST_COMPONENT = 'http';

type LogScalar = boolean | number | string | null | undefined;
type LogArray = LogScalar[];
type LogValue = LogScalar | LogArray;
export type LogBindings = Record<string, LogValue | undefined>;

export interface BaseLogFields {
  event: string;
  mode?: ServerMode;
  outcome?: 'failure' | 'success';
  request_id?: string;
  method?: string;
  path?: string;
  url?: string;
  route?: string;
  status_code?: number;
  duration_ms?: number;
  user_id?: string;
  error_code?: string;
  error_name?: string;
  cache_status?: 'hit' | 'miss' | 'set' | 'skip';
  result_count?: number;
  stored_count?: number;
  transaction_type?: string;
}

export type LogFields = BaseLogFields & LogBindings;

type LogMethod = 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn';

interface CreateLoggerOptions {
  destination?: DestinationStream;
  level?: LevelWithSilent;
  mode?: ServerMode;
  pretty?: boolean;
}

let rootLogger = createServerLogger();

export function setRootLoggerDestination(destination: DestinationStream) {
  rootLogger = createServerLogger({ destination, pretty: false });
}

export function getComponentLogger(component: string) {
  return childLogger(rootLogger, { component });
}

export function createRequestLogger(fields: {
  requestId: string;
  method: string;
  path: string;
  url: string;
  route: string;
  mode: ServerMode;
}) {
  return childLogger(rootLogger, {
    component: REQUEST_COMPONENT,
    request_id: fields.requestId,
    method: fields.method,
    path: fields.path,
    url: fields.url,
    route: fields.route,
    mode: fields.mode,
  });
}

export function childLogger(logger: Logger, bindings: LogBindings) {
  return logger.child(sanitizeLogRecord(bindings));
}

export function logEvent(logger: Logger, level: LogMethod, fields: LogFields, message?: string) {
  logger[level](sanitizeLogRecord(fields), message);
}

export function logInfo(logger: Logger, fields: LogFields, message?: string) {
  logEvent(logger, 'info', fields, message);
}

export function logWarn(logger: Logger, fields: LogFields, message?: string) {
  logEvent(logger, 'warn', fields, message);
}

export function logError(
  logger: Logger,
  fields: LogFields,
  error?: unknown,
  message?: string,
  level: Extract<LogMethod, 'error' | 'fatal'> = 'error',
) {
  const errorFields = error == null ? undefined : serializeError(error);
  const mergedFields = errorFields == null ? fields : { ...fields, ...errorFields };
  logger[level](sanitizeLogRecord(mergedFields), message);
}

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (error == null) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      error_name: error.constructor.name || error.name,
      error_message: error.message,
      error_stack: error.stack,
      error_cause_name: getErrorCauseName(error),
      error_cause_message: getErrorCauseMessage(error),
    };
  }

  return {
    error_name: typeof error,
    error_details:
      typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean'
        ? `${error}`
        : 'Non-Error value thrown',
  };
}

function createServerLogger(options: CreateLoggerOptions = {}) {
  const destination = options.destination ?? createDestination(options.pretty ?? env.DEBUG);
  const loggerOptions = createLoggerOptions(options.level ?? env.LOG_LEVEL, options.mode ?? env.MODE);

  return pino(loggerOptions, destination);
}

function createLoggerOptions(level: LevelWithSilent, mode: ServerMode): LoggerOptions {
  return {
    level,
    base: {
      service: SERVICE_NAME,
      component: DEFAULT_COMPONENT,
      mode,
    },
    redact: {
      paths: [
        'authorization',
        'Authorization',
        'cookie',
        'Cookie',
        'cookies',
        'req.headers.authorization',
        'req.headers.Authorization',
        'req.headers.cookie',
        'req.headers.Cookie',
        'headers.authorization',
        'headers.Authorization',
        'headers.cookie',
        'headers.Cookie',
        'response.headers.set-cookie',
        'response.headers.Set-Cookie',
        'jwt',
        'token',
        'sessionToken',
        'accessToken',
        'refreshToken',
        'body',
        'request.body',
        'response.body',
      ],
      censor: '[Redacted]',
    },
  };
}

function createDestination(pretty: boolean) {
  if (pretty) {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
      },
    });
  }

  return pino.destination({ sync: true });
}

export function createMemoryLogDestination(logs: string[]) {
  return new Writable({
    write(chunk: string | Uint8Array, _encoding, callback) {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });
}

function sanitizeLogRecord(record: Record<string, unknown>): LogBindings {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, sanitizeLogValue(value)]));
}

function sanitizeLogValue(value: unknown): LogValue | undefined {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value.flatMap(item => {
      const sanitizedItem = sanitizeArrayItem(item);
      return sanitizedItem === undefined ? [] : [sanitizedItem];
    });
    return sanitizedItems.length > 0 ? sanitizedItems : undefined;
  }

  return undefined;
}

function sanitizeArrayItem(value: unknown): LogScalar | undefined {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function getErrorCauseName(error: Error): string | undefined {
  const cause = error.cause;
  if (cause == null) {
    return undefined;
  }

  if (cause instanceof Error) {
    return cause.constructor.name || cause.name;
  }

  return typeof cause;
}

function getErrorCauseMessage(error: Error): string | undefined {
  const cause = error.cause;
  if (cause == null) {
    return undefined;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean') {
    return cause.toString();
  }

  return undefined;
}
