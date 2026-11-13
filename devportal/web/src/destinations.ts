import type { Destination } from './api.ts';

export const DESTINATIONS: Record<Destination, string> = { server: 'Server', ios: 'iOS', macos: 'macOS' };
export const TARGETS: readonly Destination[] = ['server', 'ios', 'macos'];
