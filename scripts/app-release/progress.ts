/** Report actual release milestones without implying that unfinished work succeeded. */
export function appReleaseProgress(note: (message: string) => void, lastOutput?: () => number) {
  return async function step<T>(label: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();

    const elapsed = (since = started) => {
      const seconds = Math.floor((performance.now() - since) / 1000);

      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    };

    note(`Starting: ${label}.`);

    const heartbeat = setInterval(() => {
      const activity = lastOutput ? ` No new tool output for ${elapsed(Math.max(started, lastOutput()))}.` : '';
      note(`${label}: ${elapsed()} elapsed.${activity}`);
    }, 30_000);

    try {
      const result = await work();
      note(`Completed: ${label} (${elapsed()}).`);

      return result;
    } catch (error) {
      note(`Stopped: ${label} (${elapsed()}).`);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  };
}
