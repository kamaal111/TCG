import * as clack from '@clack/prompts';
import z from 'zod';

import type { Choice } from './digitalocean.ts';
import { InfraFailure } from './errors.ts';

interface TextQuestion {
  message: string;
  initialValue?: string;
  validate?: (value: string) => string | undefined;
}

interface SelectionQuestion {
  message: string;
  options: Choice[];
  initialValue?: string;
}

interface ApprovalContext {
  kind: 'resume' | 'migrations' | 'deploy' | 'provision' | 'upload';
  appReview?: {
    platform: 'ios' | 'macos';
    sha: string;
    version: string;
    teamID: string;
    apiHost: string;
    fingerprint: string;
  };
  review?: { target: string; running: string | null; sha: string; fingerprint: string; pendingMigrations?: number };
}

export interface Prompts {
  text(question: TextQuestion): Promise<string>;
  password(message: string): Promise<string>;
  select(question: SelectionQuestion): Promise<string>;
  multiselect(question: Omit<SelectionQuestion, 'initialValue'>): Promise<string[]>;
  confirm(message: string, initialValue?: boolean, context?: ApprovalContext): Promise<boolean>;
  note(message: string, title?: string): void;
}

function answer<T>(schema: z.ZodType<T>, value: string | boolean | string[] | symbol): T {
  if (clack.isCancel(value)) {
    throw new InfraFailure('Cancelled. Completed steps remain saved; unfinished changes were discarded.', 130);
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new InfraFailure('The terminal returned an invalid answer. Retry the wizard.');
  }

  return parsed.data;
}

export const terminalPrompts: Prompts = {
  text: async question => {
    return answer(z.string(), await clack.text({ ...question, validate: value => question.validate?.(value ?? '') }));
  },
  password: async message => answer(z.string(), await clack.password({ message, mask: '*' })),
  select: async question => answer(z.string(), await clack.select(question)),
  multiselect: async question => answer(z.array(z.string()), await clack.multiselect({ ...question, required: false })),
  confirm: async (message, initialValue = true) => answer(z.boolean(), await clack.confirm({ message, initialValue })),
  note: (message, title) => clack.note(message, title),
};
