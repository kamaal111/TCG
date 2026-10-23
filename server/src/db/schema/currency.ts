import { sql } from 'drizzle-orm';

import { CURRENCY_CODES } from '../../forex/currencies.ts';

export const currencyConstraint = sql.raw(`('${CURRENCY_CODES.join("', '")}')`);
