import { appReleaseProgress } from './progress.ts';
import { InfraFailure } from '../infra/errors.ts';

afterEach(() => vi.useRealTimers());

test('names the active milestone and elapsed time without reporting completion early', async () => {
  vi.useFakeTimers();
  const note = vi.fn<(message: string) => void>();
  const work = Promise.withResolvers<string>();
  const running = appReleaseProgress(note)('Verifying macOS and iOS', () => work.promise);
  expect(note.mock.calls).toEqual([['Starting: Verifying macOS and iOS.']]);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(note).toHaveBeenLastCalledWith('Verifying macOS and iOS: 1m 30s elapsed.');
  expect(note.mock.calls.flat().join('\n')).not.toContain('Completed');
  work.resolve('verified');
  expect(await running).toBe('verified');
  expect(note).toHaveBeenLastCalledWith('Completed: Verifying macOS and iOS (1m 30s).');
  expect(vi.getTimerCount()).toBe(0);
});

test('identifies the stopped milestone, preserves its error and stops updates', async () => {
  vi.useFakeTimers();
  const note = vi.fn<(message: string) => void>();
  const failure = new InfraFailure('Verification failed', 7);
  await expect(appReleaseProgress(note)('Verifying macOS and iOS', () => Promise.reject(failure))).rejects.toBe(
    failure,
  );
  expect(note).toHaveBeenLastCalledWith('Stopped: Verifying macOS and iOS (0m 0s).');
  expect(note.mock.calls.flat().join('\n')).not.toContain('Completed');
  expect(vi.getTimerCount()).toBe(0);
});

test('distinguishes elapsed work from time since the last tool output', async () => {
  vi.useFakeTimers();
  let lastOutput = performance.now();
  const note = vi.fn<(message: string) => void>();
  const work = Promise.withResolvers<boolean>();
  const running = appReleaseProgress(note, () => lastOutput)('Verifying the app', () => work.promise);
  await vi.advanceTimersByTimeAsync(45_000);
  lastOutput = performance.now();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(note).toHaveBeenLastCalledWith('Verifying the app: 1m 0s elapsed. No new tool output for 0m 15s.');
  work.resolve(true);
  await running;
  expect(vi.getTimerCount()).toBe(0);
});
