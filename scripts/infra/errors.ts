import { InvalidPayload } from '@tcg/http/exceptions';

export class InfraFailure extends InvalidPayload {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(undefined, { message });
    this.exitCode = exitCode;
  }
}

export function failure(message: string): never {
  throw new InfraFailure(message);
}
