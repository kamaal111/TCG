import { PRICING_EVENTS } from '../../card-pricing/logging.ts';
import { CARDS_EVENTS } from '../../cards/logging.ts';
import { REQUEST_EVENTS } from '../request.ts';
import { SERVER_EVENTS } from '../server.ts';

// <domain>.<action>[.<detail>], lower snake — see server/docs/logging.md
const EVENT_NAME_PATTERN = /^[a-z]+(?:\.[a-z][a-z_]*)+$/;

const EVENT_CATALOGUE: [domain: string, events: readonly string[]][] = [
  ['cards', CARDS_EVENTS],
  ['pricing', PRICING_EVENTS],
  ['request', REQUEST_EVENTS],
  ['server', SERVER_EVENTS],
];

describe('Log event catalogue', () => {
  test.each(EVENT_CATALOGUE)('%s events follow the naming rule', (_domain, events) => {
    for (const event of events) {
      expect(event).toMatch(EVENT_NAME_PATTERN);
    }
  });

  test.each(EVENT_CATALOGUE)('%s events are prefixed with their domain', (domain, events) => {
    for (const event of events) {
      expect(event.startsWith(`${domain}.`)).toBe(true);
    }
  });

  test('no event name is registered twice', () => {
    const allEvents = EVENT_CATALOGUE.flatMap(([, events]) => events);

    expect(new Set(allEvents).size).toBe(allEvents.length);
  });
});
