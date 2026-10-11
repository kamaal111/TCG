import { type DomainLogFields, type DomainLogger, getDomainLogger } from './index.ts';
import type { CardImportProgress } from '../cards/logging.ts';
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
  validation_issue_codes?: string[];
  validation_issue_messages?: string[];
  import_stage?: CardImportProgress['stage'];
  import_last_completed_stage?: CardImportProgress['lastCompletedStage'];
  transaction_status?: CardImportProgress['transactionStatus'];
};

export const requestLogger = (c: HonoContext): DomainLogger<RequestLogFields> => getDomainLogger(c);
