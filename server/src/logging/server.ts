import { type DomainLogFields, type DomainLogger, getProcessLogger } from './index.ts';

export const SERVER_EVENTS = [
  'server.started',
  'server.shutdown.started',
  'server.shutdown.completed',
  'server.shutdown.forced',
] as const;

export type ServerLogFields = DomainLogFields<(typeof SERVER_EVENTS)[number]> & {
  port?: number;
  signal?: string;
};

export const serverLogger = (): DomainLogger<ServerLogFields> => getProcessLogger();
