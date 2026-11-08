import type { Host } from './contracts.ts';
import { runRelease } from './pipeline.ts';
import { InfraFailure } from '../infra/errors.ts';
import type { Prompts } from '../infra/prompts.ts';

const sha = 'd'.repeat(40);

const images = {
  runtime: `ghcr.io/example/server@sha256:${'a'.repeat(64)}`,
  migration: `ghcr.io/example/server-migrations@sha256:${'b'.repeat(64)}`,
};

const installed: Host = {
  protocol: 1,
  busy: false,
  hostname: 'api.example.com',
  repository: 'ghcr.io/example/server',
  runtime: null,
  revision: null,
  operationsRevision: sha,
  fingerprint: 'a'.repeat(64),
};

function fixture() {
  const confirm = vi.fn<Prompts['confirm']>().mockResolvedValue(true);
  confirm.mockResolvedValueOnce(false);

  const options = {
    sha,
    repository: installed.repository,
    infrastructureSuggested: false,
    prompts: {
      text: vi.fn<Prompts['text']>(),
      password: vi.fn<Prompts['password']>(),
      select: vi.fn<Prompts['select']>(),
      multiselect: vi.fn<Prompts['multiselect']>(),
      confirm,
      note: vi.fn<Prompts['note']>(),
    },
    host: vi.fn<() => Promise<Host | undefined>>().mockResolvedValue(installed),
    configure: vi.fn<Parameters<typeof runRelease>[0]['configure']>().mockResolvedValue(undefined),
    infrastructure: vi.fn<Parameters<typeof runRelease>[0]['infrastructure']>().mockResolvedValue(undefined),
    artifacts: vi.fn<Parameters<typeof runRelease>[0]['artifacts']>().mockResolvedValue(images),
    verify: vi.fn<Parameters<typeof runRelease>[0]['verify']>().mockResolvedValue(undefined),
    migrations: vi
      .fn<Parameters<typeof runRelease>[0]['migrations']>()
      .mockResolvedValue({ status: 'ready', pending: 0 }),
    migrate: vi.fn<Parameters<typeof runRelease>[0]['migrate']>().mockResolvedValue(undefined),
    deploy: vi.fn<Parameters<typeof runRelease>[0]['deploy']>().mockResolvedValue(undefined),
    check: vi.fn<Parameters<typeof runRelease>[0]['check']>().mockResolvedValue(undefined),
    complete: vi.fn<Parameters<typeof runRelease>[0]['complete']>().mockResolvedValue(undefined),
  };

  return options;
}

test('an ordinary release skips cloud credentials, infers public mode from the host and verifies health', async () => {
  const options = fixture();
  await runRelease(options);
  expect(options.infrastructure).not.toHaveBeenCalled();
  expect(options.configure).not.toHaveBeenCalled();
  expect(options.migrate).not.toHaveBeenCalled();
  expect(options.deploy).toHaveBeenCalledWith(images, installed);
  expect(options.check).toHaveBeenCalledOnce();
  expect(options.complete).toHaveBeenCalledOnce();
});

test('declining final deployment leaves the host unchanged', async () => {
  const options = fixture();
  options.prompts.confirm.mockResolvedValue(false);
  await expect(runRelease(options)).rejects.toThrow('Stopped before');
  expect(options.deploy).not.toHaveBeenCalled();
  expect(options.migrate).not.toHaveBeenCalled();
});

test('applies pending migrations only after approval, then checks readiness again', async () => {
  const options = fixture();
  options.migrations
    .mockResolvedValueOnce({ status: 'pending', pending: 2 })
    .mockResolvedValueOnce({ status: 'pending', pending: 2 });
  await runRelease(options);
  expect(options.migrate).toHaveBeenCalledWith(images.migration, installed.fingerprint);
  expect(options.migrations).toHaveBeenCalledTimes(3);
  expect(options.prompts.confirm).toHaveBeenCalledWith('Apply these database migrations?', false);
  expect(options.deploy).toHaveBeenCalledOnce();
});

test('declining migrations never deploys or changes the database', async () => {
  const options = fixture();
  options.migrations.mockResolvedValue({ status: 'pending', pending: 1 });
  options.prompts.confirm.mockResolvedValue(false);
  await expect(runRelease(options)).rejects.toThrow('Stopped before');
  expect(options.migrate).not.toHaveBeenCalled();
  expect(options.deploy).not.toHaveBeenCalled();
});

test('a database inspection error is never interpreted as pending migrations', async () => {
  const options = fixture();
  options.migrations.mockRejectedValue(new InfraFailure('Database unavailable'));
  await expect(runRelease(options)).rejects.toThrow('Database unavailable');
  expect(options.migrate).not.toHaveBeenCalled();
  expect(options.deploy).not.toHaveBeenCalled();
});

test('a failed migration prevents deployment and leaves the release resumable', async () => {
  const options = fixture();
  options.migrations.mockResolvedValue({ status: 'pending', pending: 1 });
  options.migrate.mockRejectedValue(new InfraFailure('Migration failed'));
  await expect(runRelease(options)).rejects.toThrow('Migration failed');
  expect(options.deploy).not.toHaveBeenCalled();
  expect(options.complete).not.toHaveBeenCalled();
});

test('resuming an already installed image checks live health instead of deploying again', async () => {
  const options = fixture();
  options.host.mockResolvedValue({ ...installed, runtime: images.runtime, revision: sha });
  await runRelease(options);
  expect(options.verify).toHaveBeenCalledWith(images);
  expect(options.migrations).toHaveBeenCalledOnce();
  expect(options.deploy).not.toHaveBeenCalled();
  expect(options.check).toHaveBeenCalledOnce();
});

test('requires fresh approval when the remote target changes during the prompt', async () => {
  const options = fixture();
  const changed = { ...installed, fingerprint: 'b'.repeat(64) };
  options.host
    .mockResolvedValueOnce(installed)
    .mockResolvedValueOnce(installed)
    .mockResolvedValueOnce(installed)
    .mockResolvedValue(changed);
  await runRelease(options);
  expect(options.prompts.confirm).toHaveBeenCalledTimes(3);
  expect(options.deploy).toHaveBeenCalledWith(images, changed);
});

test('a busy host stops before building or deploying', async () => {
  const options = fixture();
  options.host.mockResolvedValue({ ...installed, busy: true });
  await expect(runRelease(options)).rejects.toThrow('Another host');
  expect(options.artifacts).not.toHaveBeenCalled();
  expect(options.deploy).not.toHaveBeenCalled();
});

test('older host tools require explicit configuration before inspecting and deploying', async () => {
  const options = fixture();
  options.host.mockResolvedValueOnce(undefined);
  options.prompts.confirm.mockReset().mockResolvedValue(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await runRelease(options);
  expect(options.configure).toHaveBeenCalledOnce();
  expect(options.deploy).toHaveBeenCalledOnce();
});

test('failed image verification stops before migrations or deployment', async () => {
  const options = fixture();
  options.verify.mockRejectedValue(new InfraFailure('Wrong source label'));
  await expect(runRelease(options)).rejects.toThrow('Wrong source label');
  expect(options.migrations).not.toHaveBeenCalled();
  expect(options.deploy).not.toHaveBeenCalled();
});

test('resuming an unhealthy installed image offers an approved redeployment before verifying again', async () => {
  const options = fixture();
  options.host.mockResolvedValue({ ...installed, runtime: images.runtime, revision: sha });
  options.check.mockRejectedValueOnce(new InfraFailure('HTTPS unavailable'));
  await runRelease(options);
  expect(options.deploy).toHaveBeenCalledOnce();
  expect(options.check).toHaveBeenCalledTimes(2);
  expect(options.prompts.confirm).toHaveBeenCalledWith(
    'Deploy this release? The application will restart briefly.',
    false,
  );
});
