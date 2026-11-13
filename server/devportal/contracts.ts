import z from 'zod';

import { HostSchema, ShaSchema } from '../../scripts/release/contracts.ts';

const StageSchema = z
  .enum(['build', 'migrations', 'deploy', 'verify', 'checks', 'archive', 'upload'])
  .meta({ $id: 'PortalStage' });

export const StartSchema = z
  .strictObject({
    sha: ShaSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.uuid(),
  })
  .meta({ $id: 'StartRelease' });

export const DecisionSchema = z
  .strictObject({ approved: z.boolean(), requestId: z.uuid() })
  .meta({ $id: 'ApprovalDecision' });

const ApprovalSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['migrations', 'deploy', 'provision', 'upload']),
  appReview: z
    .object({
      platform: z.enum(['ios', 'macos']),
      sha: ShaSchema,
      version: z.string(),
      teamID: z.string(),
      apiHost: z.string(),
      fingerprint: z.string(),
    })
    .optional(),
  review: z
    .object({
      target: z.string(),
      running: ShaSchema.nullable(),
      sha: ShaSchema,
      fingerprint: z.string(),
      pendingMigrations: z.number().int().nonnegative().optional(),
    })
    .nullish(),
  message: z.string(),
});

export const ReleaseSchema = z
  .object({
    id: z.uuid(),
    target: z.enum(['server', 'ios', 'macos']).default('server'),
    sha: ShaSchema,
    fingerprint: z.string(),
    requestId: z.uuid(),
    operator: z.string(),
    createdAt: z.string(),
    state: z.enum(['running', 'approval', 'succeeded', 'failed', 'interrupted']),
    stage: StageSchema,
    approval: ApprovalSchema.nullable(),
    events: z.array(z.object({ message: z.string(), stage: StageSchema, at: z.string() })),
    decisions: z.array(
      z.object({ approvalId: z.uuid(), requestId: z.uuid(), approved: z.boolean(), operator: z.string() }),
    ),
    failure: z.string().nullable(),
  })
  .meta({ $id: 'PortalRelease' });

export const ServerSchema = z
  .object({
    target: z.string(),
    main: ShaSchema,
    host: HostSchema.nullable(),
    pending: z.number().int().nonnegative(),
    commits: z.array(z.object({ sha: ShaSchema, subject: z.string(), author: z.string(), date: z.string() })),
    nextPage: z.number().int().nullable(),
    blocker: z.string().nullable(),
    activeRelease: z.uuid().nullable(),
    latestRelease: z.uuid().nullable(),
  })
  .meta({ $id: 'PortalServer' });

export const PageSchema = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0) });

export type Release = z.infer<typeof ReleaseSchema>;

export type ServerStatus = z.infer<typeof ServerSchema>;

export type Start = z.infer<typeof StartSchema>;

export type Decision = z.infer<typeof DecisionSchema>;

export const AppStartSchema = StartSchema.extend({ platform: z.enum(['ios', 'macos']) }).meta({
  $id: 'StartAppRelease',
});

export const AppStatusSchema = ServerSchema.extend({
  platform: z.enum(['ios', 'macos']),
  fingerprint: z.string().nullable(),
  version: z.string(),
  teamID: z.string().nullable(),
  apiHost: z.string().nullable(),
  uploaded: ShaSchema.nullable(),
}).meta({ $id: 'PortalApp' });

export type AppStatus = z.infer<typeof AppStatusSchema>;

export type AppStart = z.infer<typeof AppStartSchema>;
