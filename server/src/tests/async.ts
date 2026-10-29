export function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};

  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });

  return { promise, resolve };
}
