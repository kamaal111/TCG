import { REQUEST_ID_HEADER_NAME } from '../constants/common.ts';
import { createMemoryLogDestination, setRootLoggerDestination, type LogFields } from '../logging/index.ts';

const rawLogs: string[] = [];
type StructuredLog = Partial<LogFields> & Record<string, unknown>;

export function initializeTestLogs() {
  rawLogs.length = 0;
  setRootLoggerDestination(createMemoryLogDestination(rawLogs));
}

export function createTestRequestId() {
  return `test-${crypto.randomUUID()}`;
}

export function withRequestId(headers: HeadersInit = {}, requestId = createTestRequestId()) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set(REQUEST_ID_HEADER_NAME, requestId);

  return { headers: requestHeaders, requestId };
}

export function getLogsForRequestId(requestId: string) {
  return getStructuredLogs().filter(log => log.request_id === requestId);
}

function getStructuredLogs(): StructuredLog[] {
  return rawLogs.flatMap(chunk =>
    chunk
      .split('\n')
      .filter(line => line.trim().length > 0)
      .flatMap(parseStructuredLog),
  );
}

function parseStructuredLog(line: string): StructuredLog[] {
  try {
    const parsed: unknown = JSON.parse(line);
    return isStructuredLog(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

function isStructuredLog(value: unknown): value is StructuredLog {
  return value != null && typeof value === 'object';
}
