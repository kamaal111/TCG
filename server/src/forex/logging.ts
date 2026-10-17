import { type DomainLogFields, type DomainLogger, getProcessLogger } from '../logging/index.ts';

export const FOREX_EVENTS = ['forex.collect.completed', 'forex.collect.failed'] as const;

type ForexLogFields = DomainLogFields<(typeof FOREX_EVENTS)[number]> & {
  rate_date?: string;
  collection_status?: string;
};

export const forexProcessLogger = (): DomainLogger<ForexLogFields> => getProcessLogger();
