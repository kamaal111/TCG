import childProcess from 'node:child_process';
import events from 'node:events';

const lifecycle = new URL('../src/node-server-lifecycle.ts', import.meta.url).href;
const logging = new URL('../src/logging.ts', import.meta.url).href;
const nodeLogging = new URL('../src/node-logging.ts', import.meta.url).href;

async function fixture(mode = 'normal') {
  const child = childProcess.spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import http from 'node:http';
    import { registerNodeServerShutdown } from ${JSON.stringify(lifecycle)};
    import { configureLogging } from ${JSON.stringify(logging)};
    import { createNodeLogger } from ${JSON.stringify(nodeLogging)};
    const logger = createNodeLogger({ service: 'lifecycle-test', mode: 'SERVER' });
    configureLogging({ root: logger, createRequestLogger: fields => logger.child(fields) });
    const mode = ${JSON.stringify(mode)};
    let response;
    const server = http.createServer((_request, outgoing) => {
      response = outgoing;
      process.send({ requested: true });
    });
    registerNodeServerShutdown({
      server: () => mode === 'initializing' ? undefined : server,
      stop: () => { process.send({ stopping: true }); },
      dispose: async () => {
        process.send({ disposed: true });
        if (mode === 'failure') throw new Error('private cleanup details');
        if (mode === 'timeout') await new Promise(() => {});
      },
    });
    process.on('message', message => {
      if (message === 'complete') response.end('finished');
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );

  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  let output = '';
  child.stdout?.on('data', chunk => {
    output += chunk;
  });
  child.stderr?.on('data', chunk => {
    output += chunk;
  });
  const messages: unknown[] = [];
  child.on('message', message => messages.push(message));
  const ready = await events.once(child, 'message');
  const port = ready[0].port;
  const exited = events.once(child, 'exit');

  return { child, port, messages, exited, output: () => output };
}

test.each(['SIGINT', 'SIGTERM'] as const)(
  'drains requests before cleanup on %s, including repeated signals',
  async signal => {
    const f = await fixture();
    const requested = events.once(f.child, 'message');
    const response = fetch(`http://127.0.0.1:${f.port}`);
    await requested;
    const stopping = events.once(f.child, 'message');
    f.child.kill(signal);
    await stopping;
    f.child.kill(signal);
    expect(f.messages).not.toContainEqual({ disposed: true });
    f.child.send('complete');
    expect(await (await response).text()).toBe('finished');
    expect(await f.exited).toEqual([0, null]);
    expect(f.messages.filter(message => JSON.stringify(message) === '{"disposed":true}')).toHaveLength(1);
    expect(f.output()).toContain('server.shutdown.completed');
  },
);

test('releases resources when termination arrives during initialization', async () => {
  const f = await fixture('initializing');
  f.child.kill('SIGTERM');
  expect(await f.exited).toEqual([0, null]);
  expect(f.messages).toContainEqual({ disposed: true });
});

test('reports cleanup failures without exposing diagnostic details', async () => {
  const f = await fixture('failure');
  f.child.kill('SIGTERM');
  expect(await f.exited).toEqual([1, null]);
  expect(f.output()).toContain('SHUTDOWN_FAILED');
  expect(f.output()).not.toContain('private cleanup details');
});

test('bounds resource cleanup by the shared shutdown deadline', { timeout: 20_000 }, async () => {
  const f = await fixture('timeout');
  f.child.kill('SIGTERM');
  expect(await f.exited).toEqual([1, null]);
  expect(f.output()).toContain('SHUTDOWN_TIMEOUT');
});
