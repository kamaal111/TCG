import { useState } from 'react';

import type { Destination } from './api.ts';
import { DestinationPanel } from './destination-panel.tsx';
import { DESTINATIONS, TARGETS } from './destinations.ts';

export function Portal() {
  const [destination, setDestination] = useState<Destination>('server');

  return (
    <main>
      <header>
        <h1>Mintomo Devportal</h1>
        <nav aria-label="Release destination">
          {TARGETS.map(target => {
            return (
              <button
                key={target}
                type="button"
                aria-pressed={target === destination}
                onClick={() => setDestination(target)}
              >
                {DESTINATIONS[target]}
              </button>
            );
          })}
        </nav>
      </header>
      <DestinationPanel key={destination} destination={destination} />
    </main>
  );
}
