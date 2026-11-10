import { type DomainLogFields, type DomainLogger, type RequestLogger, getDomainLogger } from './logging.ts';
import type { CardImportProgress } from './progress.ts';

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

export const requestLogger = (c: { get(key: 'logger'): RequestLogger }): DomainLogger<RequestLogFields> => {
  return getDomainLogger(c);
};
