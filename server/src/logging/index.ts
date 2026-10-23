import type { ServerMode } from '../constants/common.ts';
import type { HonoContext } from '../context.ts';
import { InternalServerError } from '../exceptions/index.ts';

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

export interface RequestLogger {
  info<Fields extends DomainLogFields<string>>(fields: Fields, message: string): void;
  warn<Fields extends DomainLogFields<string>>(fields: Fields, message: string): void;
  error<Fields extends DomainLogFields<string>>(fields: Fields, message: string): void;
  child(bindings: RequestLoggerBindings): RequestLogger;
}

interface LoggingBackend {
  root: RequestLogger;
  createRequestLogger(fields: {
    request_id: string;
    method: string;
    path: string;
    url: string;
    mode: ServerMode;
    user_agent: string | undefined;
  }): RequestLogger;
}

let backend: LoggingBackend | undefined;

export function configureLogging(value: LoggingBackend): void {
  backend = value;
}

function getLoggingBackend(): LoggingBackend {
  if (backend == null) {
    throw new InternalServerError(undefined, { diagnosticMessage: 'Logging must be configured by the runtime' });
  }

  return backend;
}

export function getDomainLogger<Fields extends DomainLogFields<string>>(c: HonoContext): DomainLogger<Fields> {
  return c.get('logger');
}

export function getProcessLogger<Fields extends DomainLogFields<string>>(): DomainLogger<Fields> {
  return getLoggingBackend().root;
}

export function createRequestLogger(fields: {
  requestId: string;
  method: string;
  path: string;
  url: string;
  mode: ServerMode;
  userAgent: string | undefined;
}): RequestLogger {
  return getLoggingBackend().createRequestLogger({
    request_id: fields.requestId,
    method: fields.method,
    path: fields.path,
    url: fields.url,
    mode: fields.mode,
    user_agent: fields.userAgent,
  });
}
