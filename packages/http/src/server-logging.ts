import { type DomainLogFields, type DomainLogger, getProcessLogger } from './logging.ts';

export const SERVER_EVENTS = [
  'server.started',
  'server.shutdown.started',
  'server.shutdown.completed',
  'server.shutdown.forced',
] as const;

type ServerLogFields = DomainLogFields<(typeof SERVER_EVENTS)[number]> & {
  port?: number;
  signal?: string;
};

export const serverLogger = (): DomainLogger<ServerLogFields> => getProcessLogger();
