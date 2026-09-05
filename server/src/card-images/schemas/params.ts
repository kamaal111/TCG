import z from 'zod';

export type GetImageParams = z.infer<typeof GetImageParamsSchema>;

export const GetImageParamsSchema = z.object({ imageKey: z.string().regex(/^[0-9a-f]{64}$/) });
