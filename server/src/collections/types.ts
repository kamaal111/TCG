import type { DEFAULT_COLLECTION_POLICY } from '../config.ts';

export type CollectionPolicy = { [Key in keyof typeof DEFAULT_COLLECTION_POLICY]: number };
