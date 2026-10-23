/** Scheduling policy belongs to the host runtime; registration itself never starts timers. */
export interface CardImageScheduler {
  notifyRegistered(count: number): void;
}
