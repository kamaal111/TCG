import { type DomainLogFields, type DomainLogger, getDomainLogger } from './index.ts';
import type { HonoContext } from '../context.ts';

export const REQUEST_EVENTS = [
  'request.completed',
  'request.error',
  'request.validation.failed',
  'request.failed',
] as const;

export type RequestLogFields = DomainLogFields<(typeof REQUEST_EVENTS)[number]> & {
  route?: string;
  status_code?: number;
  validation_issue_count?: number;
  validation_issue_paths?: string[];
};

export const requestLogger = (c: HonoContext): DomainLogger<RequestLogFields> => getDomainLogger(c);
