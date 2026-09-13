import z from 'zod';

export const ApiCommonDatetime = z.iso.datetime({ offset: true });
