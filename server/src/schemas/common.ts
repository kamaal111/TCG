import z from 'zod';

export const ApiCommonDatetime = z.iso.datetime({ offset: true });

export const ApiCountSchema = z.int32().nonnegative();

export const UuidSchema = z.uuid().toLowerCase().meta({
  description: 'UUID identifier, normalized to lowercase',
  example: '550e8400-e29b-41d4-a716-446655440000',
});
