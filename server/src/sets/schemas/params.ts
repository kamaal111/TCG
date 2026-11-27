import { z } from 'zod';

import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { base64UrlCursorPattern, paginationCursor } from '../../utils/pagination.ts';
import { SET_CHECKLIST_FILTER_MAP, SET_LIST_SECTION_MAP } from '../constants.ts';
import { decodeSetCursor } from '../utils/pagination.ts';

const GameSchema = z.enum(CARD_GAME_MAP);

export const SetPathSchema = z.object({
  game: GameSchema,
  set_id: z
    .string()
    .regex(/^[a-z0-9_-]+$/i)
    .max(200),
});

export const SetCardPathSchema = SetPathSchema.extend({ number: z.string().trim().nonempty().max(200) });

const SetCursorSchema = paginationCursor(
  z.string().max(2048).regex(base64UrlCursorPattern),
  decodeSetCursor,
).optional();

export const SetListQuerySchema = z.object({
  game: GameSchema,
  query: z.string().trim().max(200).optional(),
  section: z.enum(SET_LIST_SECTION_MAP).optional(),
  cursor: SetCursorSchema,
});

export const ChecklistQuerySchema = z.object({
  filter: z.enum(SET_CHECKLIST_FILTER_MAP).optional(),
  cursor: SetCursorSchema,
});

export type SetPath = z.infer<typeof SetPathSchema>;

export type SetCardPath = z.infer<typeof SetCardPathSchema>;

export type SetListQuery = z.infer<typeof SetListQuerySchema>;

export type ChecklistQuery = z.infer<typeof ChecklistQuerySchema>;
