import { InternalServerError } from '../exceptions/index.ts';

export abstract class ForexError extends InternalServerError {
  abstract readonly reason: string;

  constructor(message: string, options?: ErrorOptions) {
    super(undefined, { diagnosticMessage: message, cause: options?.cause });
  }
}

export class ForexRequestFailed extends ForexError {
  readonly reason = 'request_failed';
  readonly statusCode: number | undefined;

  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}

export class ForexInvalidResponse extends ForexError {
  readonly reason = 'invalid_response';
}

export class ForexReadFailed extends ForexError {
  readonly reason = 'read_failed';

  constructor(cause: unknown) {
    super('Could not read stored exchange rates', { cause });
  }
}

export class ForexStoredSnapshotInvalid extends ForexError {
  readonly reason = 'invalid_stored_snapshot';

  constructor(cause: unknown) {
    super('Stored exchange rates are invalid', { cause });
  }
}

export class ForexWriteFailed extends ForexError {
  readonly reason = 'write_failed';

  constructor(cause: unknown) {
    super('Could not store exchange rates', { cause });
  }
}
