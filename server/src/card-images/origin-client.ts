import { err, ok, type Result } from 'neverthrow';

import env from '../env.ts';

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);

export const CARD_IMAGE_ORIGIN_ERROR_REASONS = {
  HTTP_ERROR: 'http_error',
  INVALID_CONTENT_LENGTH: 'invalid_content_length',
  INVALID_CONTENT_TYPE: 'invalid_content_type',
  NETWORK_ERROR: 'network_error',
  REQUEST_TIMEOUT: 'request_timeout',
} as const;

type CardImageOriginErrorReason =
  (typeof CARD_IMAGE_ORIGIN_ERROR_REASONS)[keyof typeof CARD_IMAGE_ORIGIN_ERROR_REASONS];

type CardImageOriginError = {
  reason: CardImageOriginErrorReason;
  message: string;
  statusCode?: number;
  isRetryable: boolean;
};

type OriginImage = { body: Uint8Array; contentType: string };
export type CardImageOriginResult = Result<OriginImage, CardImageOriginError>;

export interface CardImageOriginClient {
  fetchImage(url: string): Promise<CardImageOriginResult>;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HttpCardImageOriginClient implements CardImageOriginClient {
  private readonly fetchImplementation: Fetch;
  private readonly maxBytes: number;
  private readonly requestTimeoutMs: number;

  constructor(options: { fetch?: Fetch; maxBytes?: number; requestTimeoutMs?: number } = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? env.CARD_IMAGE_MAX_BYTES;
    this.requestTimeoutMs = options.requestTimeoutMs ?? env.CARD_IMAGE_REQUEST_TIMEOUT_MS;
  }

  async fetchImage(url: string): Promise<CardImageOriginResult> {
    const fetchResult = await this.fetchFromOrigin(url);
    if (fetchResult.isErr()) return err(fetchResult.error);
    const response = fetchResult.value;
    if (!response.ok) {
      return err({
        reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.HTTP_ERROR,
        message: `Card image origin returned status ${response.status}`,
        statusCode: response.status,
        isRetryable: response.status === 429 || response.status >= 500,
      });
    }
    const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType == null || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return err({
        reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.INVALID_CONTENT_TYPE,
        message: 'Card image has an unsupported content type',
        isRetryable: false,
      });
    }
    const declaredLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      return err({
        reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.INVALID_CONTENT_LENGTH,
        message: 'Card image exceeds the maximum size',
        isRetryable: false,
      });
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > this.maxBytes) {
      return err({
        reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.INVALID_CONTENT_LENGTH,
        message: 'Card image exceeds the maximum size',
        isRetryable: false,
      });
    }
    return ok({ body, contentType });
  }

  private async fetchFromOrigin(url: string): Promise<Result<Response, CardImageOriginError>> {
    try {
      return ok(await this.fetchImplementation(url, { signal: AbortSignal.timeout(this.requestTimeoutMs) }));
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return err({
        reason: timedOut
          ? CARD_IMAGE_ORIGIN_ERROR_REASONS.REQUEST_TIMEOUT
          : CARD_IMAGE_ORIGIN_ERROR_REASONS.NETWORK_ERROR,
        message: timedOut ? 'Card image request timed out' : 'Card image request failed',
        isRetryable: true,
      });
    }
  }
}
