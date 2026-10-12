interface ConnectionLifecycle {
  once(event: 'end', listener: () => void): void;
}

interface PoolLifecycle {
  on(event: 'connect', listener: (client: ConnectionLifecycle) => void): void;
  end(): Promise<void>;
}

export function trackPoolShutdown(pool: PoolLifecycle): () => Promise<void> {
  const pending = new Set<Promise<void>>();

  pool.on('connect', client => {
    const closed = Promise.withResolvers<undefined>();
    pending.add(closed.promise);
    client.once('end', () => {
      pending.delete(closed.promise);
      closed.resolve(undefined);
    });
  });

  return async () => {
    await pool.end();
    await Promise.all(pending);
  };
}
