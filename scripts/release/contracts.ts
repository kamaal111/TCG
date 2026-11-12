import { sha256Hex } from '@tcg/crypto/sha256';
import z from 'zod';

import { InfraFailure } from '../infra/errors.ts';
import { ReleaseRepositorySchema } from '../release-metadata.ts';

export const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

const digest = z.string().regex(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);

export const ArtifactsSchema = z.object({ runtime: digest, migration: digest });

export const HostSchema = z.object({
  protocol: z.literal(1),
  busy: z.boolean(),
  hostname: z.union([z.literal(''), z.hostname()]),
  repository: ReleaseRepositorySchema,
  runtime: digest.nullable(),
  revision: ShaSchema.nullable(),
  operationsRevision: z.union([z.literal(''), ShaSchema]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type Host = z.infer<typeof HostSchema>;

export type Artifacts = z.infer<typeof ArtifactsSchema>;

export function fingerprint(values: readonly string[]): string {
  return sha256Hex(JSON.stringify(values));
}

interface MigrationStatus {
  status: 'ready' | 'pending';
  pending: number;
}

export function migrationStatus(output: string): MigrationStatus {
  try {
    return parseMigrationStatus(output);
  } catch {
    throw new InfraFailure(
      'Cannot determine migration readiness. Check database connectivity and the private release log; no migrations were started.',
    );
  }
}

function parseMigrationStatus(output: string): MigrationStatus {
  if (output.trim() === 'Required database migrations are applied.') {
    return { status: 'ready', pending: 0 };
  }

  const parsed = z
    .object({ protocol: z.literal(1), status: z.enum(['ready', 'pending']), pending: z.number().int().nonnegative() })
    .safeParse(JSON.parse(output));

  if (!parsed.success || (parsed.data.status === 'ready') !== (parsed.data.pending === 0)) {
    throw new InfraFailure(
      'Cannot determine migration readiness. Check the private release log; no migrations were started.',
    );
  }

  return parsed.data;
}

const ChangeSchema = z.object({ actions: z.array(z.string()) });

export const PlanSchema = z.object({
  resource_changes: z
    .array(
      z.object({
        address: z.string(),
        change: ChangeSchema.extend({ importing: z.object({ id: z.string() }).optional() }),
      }),
    )
    .default([]),
  output_changes: z.record(z.string(), ChangeSchema).default({}),
});

export function summarizePlan(plan: z.infer<typeof PlanSchema>) {
  const changes = plan.resource_changes.filter(
    resource => resource.change.importing !== undefined || resource.change.actions.some(action => action !== 'no-op'),
  );

  const outputs = Object.entries(plan.output_changes).filter(([, change]) => {
    return change.actions.some(action => action !== 'no-op');
  });

  return {
    changed: changes.length > 0 || outputs.length > 0,
    summary:
      [
        ...changes.map(resource => `${resource.address}: ${resource.change.actions.join(', ')}`),
        ...outputs.map(([name]) => `Output: ${name}`),
      ].join('\n') || 'No changes.',
  };
}
