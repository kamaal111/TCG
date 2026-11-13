import childProcess from 'node:child_process';
import path from 'node:path';

import { InfraFailure } from '../../scripts/infra/errors.ts';

export interface PortalCommands {
  read: (program: string, args: string[]) => string;
  run: (program: string, args: string[]) => void;
}

export function portalCommands(root: string, retry: string): PortalCommands {
  return {
    read: (program, args) => {
      try {
        return childProcess.execFileSync(program, args, {
          cwd: root,
          encoding: 'utf8',
          timeout: 20_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        throw new InfraFailure(
          `Could not run ${path.basename(program)} ${args.join(' ')}. Check the installed tool and its required services, then rerun ${retry}.`,
        );
      }
    },
    run: (program, args) => {
      const result = childProcess.spawnSync(program, args, { cwd: root, stdio: 'inherit' });

      if (result.status !== 0) {
        throw new InfraFailure(
          `${path.basename(program)} did not finish. Follow its message above, then rerun ${retry}. Completed settings remain saved.`,
        );
      }
    },
  };
}
