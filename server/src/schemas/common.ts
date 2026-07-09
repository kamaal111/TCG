import z from 'zod';

export const ApiCommonDatetimeShape = z.iso.datetime({ offset: true });
