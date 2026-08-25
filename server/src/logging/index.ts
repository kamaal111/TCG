import { Writable } from 'node:stream';

import type { AuthLogFields } from '@kamaalio/kamaal-auth-hono';
import type { DestinationStream, LevelWithSilent, Logger, LoggerOptions } from 'pino';
import pino from 'pino';

import type { RequestLogFields } from './request.ts';
import type { ServerLogFields } from './server.ts';
import type { PricingLogFields } from '../card-pricing/logging.ts';
import type { CardsLogFields } from '../cards/logging.ts';
import type { ServerMode } from '../constants/common.ts';
import type { HonoContext } from '../context.ts';
import env from '../env.ts';

const SERVICE_NAME = 'tcg-server';

export interface CommonLogFields {
  outcome: 'failure' | 'success';
  error_code?: string;
  duration_ms?: number;
}

export type DomainLogFields<Event extends string> = CommonLogFields & { event: Event };

export interface DomainLogger<Fields extends DomainLogFields<string>> {
  info(fields: Fields, message: string): void;
  warn(fields: Fields, message: string): void;
  error(fields: Fields & { err?: unknown }, message: string): void;
}

interface RequestLoggerBindings {
  user_id: string;
}

type AnyLogFields = AuthLogFields | CardsLogFields | PricingLogFields | RequestLogFields | ServerLogFields;

export interface RequestLogger {
  info(fields: AnyLogFields, message: string): void;
  warn(fields: AnyLogFields, message: string): void;
  error(fields: AnyLogFields, message: string): void;
  child(bindings: RequestLoggerBindings): RequestLogger;
}

interface CreateLoggerOptions {
  destination?: DestinationStream;
  level?: LevelWithSilent;
  mode?: ServerMode;
  pretty?: boolean;
}

let rootLogger = createServerLogger();

export function getDomainLogger<Fields extends DomainLogFields<string>>(c: HonoContext): DomainLogger<Fields> {
  return c.get('logger') as DomainLogger<Fields>;
}

export function getProcessLogger<Fields extends DomainLogFields<string>>(): DomainLogger<Fields> {
  return getRootLogger() as DomainLogger<Fields>;
}

export function createRequestLogger(fields: {
  requestId: string;
  method: string;
  path: string;
  url: string;
  mode: ServerMode;
  userAgent: string | undefined;
}): RequestLogger {
  return getRootLogger().child({
    request_id: fields.requestId,
    method: fields.method,
    path: fields.path,
    url: fields.url,
    mode: fields.mode,
    user_agent: fields.userAgent,
  });
}

export function setRootLoggerDestination(destination: DestinationStream) {
  rootLogger = createServerLogger({ destination, pretty: false });
}

export function createMemoryLogDestination(logs: string[]) {
  return new Writable({
    write(chunk: string | Uint8Array, _encoding, callback) {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });
}

function getRootLogger() {
  return rootLogger;
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
