import type childProcess from 'node:child_process';

export function waitForProcessOutput(child: childProcess.ChildProcess, expected: string): Promise<void> {
  const streams = [child.stdout, child.stderr].filter(stream => stream !== null);

  if (!streams.length) {
    throw new Error('The process fixture requires an output pipe.');
  }

  return new Promise((resolve, reject) => {
    let output = '';

    const cleanup = () => {
      for (const stream of streams) {
        stream.removeListener('data', data);
      }

      child.removeListener('close', close);
      child.removeListener('error', failed);
    };

    const data = (chunk: Buffer | string) => {
      output += chunk.toString();

      if (output.includes(expected)) {
        cleanup();
        resolve();
      }
    };

    const close = (code: number | null) => {
      cleanup();
      reject(new Error(`Process exited with ${code} before reporting ${expected}: ${output}`));
    };

    const failed = (cause: Error) => {
      cleanup();
      reject(cause);
    };

    for (const stream of streams) {
      stream.on('data', data);
    }

    child.once('close', close);
    child.once('error', failed);
  });
}
