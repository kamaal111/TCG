import { COLLECTION_BUFFER_BYTES } from './constants.ts';
import { CollectionOperationTimeout } from './exceptions.ts';
import type { CollectionBackup } from './schemas/responses.ts';
import type { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { MIME_TYPES } from '../constants/request.ts';
import { toError } from '../utils/results.ts';

export interface BackupWriter {
  ready(): void;
  write(text: string): Promise<void>;
}

interface BackupStreamOptions {
  produce: (writer: BackupWriter) => Promise<void>;
  completed: () => void;
  failed: (error: Error) => void;
  signal: AbortSignal;
  timeoutMs: number;
}

export async function collectionBackupStream({
  produce,
  completed,
  failed,
  signal,
  timeoutMs,
}: BackupStreamOptions): Promise<ReadableStream<Uint8Array>> {
  const ready = Promise.withResolvers<undefined>();
  const cancellation = new AbortController();

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      cancellation.signal.addEventListener(
        'abort',
        () => {
          const error = new CollectionOperationTimeout();
          ready.reject(error);
          controller.error(error);
        },
        { once: true },
      );
    },
  });

  const output = stream.writable.getWriter();
  const abort = () => cancellation.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal.addEventListener('abort', abort, { once: true });

  if (signal.aborted) {
    abort();
  }

  const encoder = new TextEncoder();
  let buffer = new Uint8Array(COLLECTION_BUFFER_BYTES);
  let bufferedBytes = 0;
  let firstWrite = true;

  const flush = async () => {
    if (bufferedBytes === 0) {
      return;
    }

    const chunk = buffer.subarray(0, bufferedBytes);
    buffer = new Uint8Array(COLLECTION_BUFFER_BYTES);
    bufferedBytes = 0;
    await output.write(chunk);
  };

  const writer: BackupWriter = {
    ready: () => ready.resolve(undefined),
    write: async text => {
      // Observe cancellation even when the next fragment fits in the byte buffer.
      await output.ready;
      const bytes = encoder.encode(text);

      for (let start = 0; start < bytes.byteLength;) {
        const length = Math.min(COLLECTION_BUFFER_BYTES - bufferedBytes, bytes.byteLength - start);
        buffer.set(bytes.subarray(start, start + length), bufferedBytes);
        bufferedBytes += length;
        start += length;

        if (bufferedBytes === COLLECTION_BUFFER_BYTES) {
          await flush();
        }
      }

      if (firstWrite && bytes.byteLength > 0) {
        // Keep the initial response prompt and backpressured before buffering later fragments.
        firstWrite = false;
        await flush();
      }
    },
  };

  void produce(writer)
    .then(async () => {
      // The final token is withheld until the export transaction has committed.
      await writer.write('}');
      await flush();
      await output.close();
      completed();
    })
    .catch(async cause => {
      const error = toError(cause);
      ready.reject(error);
      failed(error);
      await output.abort(error).catch(() => undefined);
    })
    .finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    });
  await ready.promise;

  return stream.readable;
}

export class CollectionBackupResponse extends Response {
  declare readonly _data: CollectionBackup;
  declare readonly _status: typeof CONTENTFUL_STATUS_CODES.OK;
  declare readonly _format: 'json';

  constructor(body: ReadableStream<Uint8Array>) {
    super(body, { headers: { 'Content-Type': MIME_TYPES.JSON } });
  }
}
