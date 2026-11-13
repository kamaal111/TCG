import type { ReactNode } from 'react';

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Revision({ sha }: { sha: string | null | undefined }) {
  return sha ? <code title={sha}>{sha.slice(0, 12)}</code> : '—';
}
