import { useEffect, useRef, useState } from 'react';

export type RunOperation = (work: (signal: AbortSignal) => Promise<void>, interactive?: boolean) => Promise<void>;

export function usePortalOperation() {
  const [busy, setBusy] = useState(false);
  const operation = useRef<{ controller: AbortController; interactive: boolean } | null>(null);

  async function perform(work: (signal: AbortSignal) => Promise<void>, interactive = true) {
    if (operation.current?.interactive || (operation.current && !interactive)) {
      return;
    }

    operation.current?.controller.abort();

    const controller = new AbortController();
    operation.current = { controller, interactive };

    if (interactive) {
      setBusy(true);
    }

    try {
      await work(controller.signal);
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;

        if (interactive) {
          setBusy(false);
        }
      }
    }
  }

  useEffect(() => {
    return () => {
      operation.current?.controller.abort();
      operation.current = null;
    };
  }, []);

  return { busy, perform };
}
