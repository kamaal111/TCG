import { collectionBackupStream } from '../backup-stream.ts';
import { COLLECTION_BUFFER_BYTES } from '../constants.ts';
import { CollectionOperationTimeout } from '../exceptions.ts';

const DOCUMENT = '{"version":1,"collections":[],"cards":[]';

function streamCallbacks() {
  return {
    completed: vi.fn<() => void>(),
    failed: vi.fn<(error: Error) => void>(),
    signal: new AbortController().signal,
    timeoutMs: 1000,
  };
}

test('backpressure keeps production pending until the consumer reads and completion closes the document', async () => {
  const callbacks = streamCallbacks();
  const produced = vi.fn<() => void>();

  const stream = await collectionBackupStream({
    ...callbacks,
    produce: async writer => {
      writer.ready();
      await writer.write(DOCUMENT);
      produced();
    },
  });

  expect(produced).not.toHaveBeenCalled();
  expect(await new Response(stream).json()).toEqual({ version: 1, collections: [], cards: [] });
  await expect.poll(() => callbacks.completed.mock.calls.length).toBe(1);
  expect(callbacks.failed).not.toHaveBeenCalled();
});

test('a failed producer aborts buffered data instead of completing a partial document', async () => {
  const callbacks = streamCallbacks();
  const failure = new CollectionOperationTimeout();

  const stream = await collectionBackupStream({
    ...callbacks,
    produce: async writer => {
      writer.ready();
      await writer.write(DOCUMENT);
      await writer.write(',"uncommitted":true');
      throw failure;
    },
  });

  await expect(new Response(stream).text()).rejects.toBe(failure);
  expect(callbacks.completed).not.toHaveBeenCalled();
  expect(callbacks.failed).toHaveBeenCalledWith(failure);
});

test('coalesces small UTF-8 fragments into one initial chunk and two bounded data chunks', async () => {
  const fragment = 'é🂡';
  const fragmentBytes = new TextEncoder().encode(fragment).byteLength;
  const fragmentCount = Math.ceil(COLLECTION_BUFFER_BYTES / fragmentBytes) + 1;
  const lengths: number[] = [];

  const stream = await collectionBackupStream({
    ...streamCallbacks(),
    produce: async writer => {
      writer.ready();
      await writer.write('{"text":"');

      for (let index = 0; index < fragmentCount; index += 1) {
        await writer.write(fragment);
      }

      await writer.write('"');
    },
  });

  const observed = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        lengths.push(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );

  expect(await new Response(observed).json()).toEqual({ text: fragment.repeat(fragmentCount) });
  expect(lengths).toHaveLength(3);
  expect(lengths.every(length => length <= COLLECTION_BUFFER_BYTES)).toBe(true);
});

test('consumer cancellation interrupts production before another buffered fragment is accepted', async () => {
  const callbacks = streamCallbacks();
  const resume = Promise.withResolvers<undefined>();

  const stream = await collectionBackupStream({
    ...callbacks,
    produce: async writer => {
      writer.ready();
      await writer.write(DOCUMENT);
      await resume.promise;
      await writer.write(',"uncommitted":true');
    },
  });

  const reader = stream.getReader();

  expect((await reader.read()).done).toBe(false);
  await reader.cancel();
  resume.resolve(undefined);
  await expect.poll(() => callbacks.failed.mock.calls.length).toBe(1);
  expect(callbacks.completed).not.toHaveBeenCalled();
});

test('the deadline interrupts an export stalled by a non-reading consumer', async () => {
  vi.useFakeTimers();

  try {
    const callbacks = streamCallbacks();

    const stream = await collectionBackupStream({
      ...callbacks,
      produce: async writer => {
        writer.ready();
        await writer.write(DOCUMENT);
      },
    });

    await vi.advanceTimersByTimeAsync(callbacks.timeoutMs);
    await expect(new Response(stream).text()).rejects.toBeInstanceOf(CollectionOperationTimeout);
    expect(callbacks.completed).not.toHaveBeenCalled();
    expect(callbacks.failed).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
