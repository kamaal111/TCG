import childProcess from 'node:child_process';
import util from 'node:util';

const execute = util.promisify(childProcess.execFile);

for (const entrypoint of ['agent.ts', 'agent-service-cli.ts', 'setup-cli.ts']) {
  describe(`${entrypoint}`, () => {
    const script = new URL(entrypoint, import.meta.url);

    test('shows help without accessing configuration or requiring a terminal', async () => {
      const result = await execute(process.execPath, [script.pathname, '--help'], {
        env: { ...process.env, TCG_CONFIG_DIRECTORY: '' },
      });

      expect(result.stdout).toContain('Usage: just');
      expect(result.stderr).toBe('');
    });

    test.each([['--unknown'], ['--config-dir'], ['--config-dir', ''], ['--config-dir', '   '], ['wrong-action']])(
      'rejects invalid arguments %j before accessing configuration',
      async (...args) => {
        await expect(execute(process.execPath, [script.pathname, ...args])).rejects.toMatchObject({
          code: 64,
          stderr: expect.stringContaining('Usage: just'),
        });
      },
    );

    test('rejects extra positional arguments', async () => {
      await expect(execute(process.execPath, [script.pathname, 'status', 'extra'])).rejects.toMatchObject({ code: 64 });
    });
  });
}
