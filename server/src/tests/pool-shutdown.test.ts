import events from 'node:events';
import timers from 'node:timers/promises';

import { trackPoolShutdown } from './pool-shutdown.ts';

class TestPool extends events.EventEmitter {
  shutdown = Promise.withResolvers<undefined>();
  end = vi.fn<() => Promise<undefined>>(() => this.shutdown.promise);
}

describe('tracked pool shutdown', () => {
  test('waits for a client to close after pool.end resolves', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    const client = new events.EventEmitter();
    pool.emit('connect', client);
    const completed = vi.fn<() => void>();
    const closing = close().then(completed);

    pool.shutdown.resolve(undefined);
    await timers.setImmediate();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    client.emit('end');
    await closing;
    expect(completed).toHaveBeenCalledOnce();
  });

  test('waits for every connected client before completing', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    const first = new events.EventEmitter();
    const second = new events.EventEmitter();
    pool.emit('connect', first);
    pool.emit('connect', second);
    const completed = vi.fn<() => void>();
    const closing = close().then(completed);

    pool.shutdown.resolve(undefined);
    first.emit('end');
    await timers.setImmediate();
    expect(completed).not.toHaveBeenCalled();
    second.emit('end');
    await closing;
    expect(completed).toHaveBeenCalledOnce();
  });

  test('does not wait again for a client that closed before shutdown', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    const client = new events.EventEmitter();
    pool.emit('connect', client);
    client.emit('end');
    pool.shutdown.resolve(undefined);

    await close();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(client.listenerCount('end')).toBe(0);
  });

  test('completes shutdown when the pool has never connected', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    pool.shutdown.resolve(undefined);

    await close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  test('tracks a connection established while pool shutdown is pending', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    const completed = vi.fn<() => void>();
    const closing = close().then(completed);
    const client = new events.EventEmitter();
    pool.emit('connect', client);

    pool.shutdown.resolve(undefined);
    await timers.setImmediate();
    expect(completed).not.toHaveBeenCalled();
    client.emit('end');
    await closing;
    expect(completed).toHaveBeenCalledOnce();
  });

  test('propagates pool shutdown errors', async () => {
    const pool = new TestPool();
    const close = trackPoolShutdown(pool);
    const failure = new Error('Pool shutdown failed');
    const closing = close();
    pool.shutdown.reject(failure);

    await expect(closing).rejects.toBe(failure);
  });
});
