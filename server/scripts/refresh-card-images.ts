import z from 'zod';

import { CardImageRepository } from '../src/card-images/repository.ts';
import { createDatabaseOnlyContext } from '../src/context.ts';
import db from '../src/db/index.ts';

const IMAGE_KEY_PATTERN = /^[0-9a-f]{64}$/;

const ArgsSchema = z.tuple([
  z.string().nonempty('Pass an image key or an origin URL pattern such as "https://images.scrydex.com/%"'),
]);

/**
 * Sends already-stored card images back through materialization.
 *
 * A `ready` image is never re-fetched, which is what we want when origin URLs are stable. This is
 * the lever for when the stored bytes themselves are wrong: an origin placeholder cached as card
 * art, or a change to how images are fetched or stored.
 */
async function refreshCardImages(target: string) {
  const repository = new CardImageRepository(createDatabaseOnlyContext(db));
  const imageKeys = await getImageKeys(target, repository);

  if (imageKeys.length === 0) {
    console.log('ℹ️ No stored card images matched; nothing to refresh.');

    return;
  }

  const refreshed = await repository.requeueForRefresh(imageKeys);
  console.log(`✅ Queued ${refreshed} card image(s) for refresh. The warmer picks them up on its next cycle.`);
}

async function getImageKeys(target: string, repository: CardImageRepository): Promise<string[]> {
  if (IMAGE_KEY_PATTERN.test(target)) {
    return [target];
  }

  const readies = await repository.findReadyImageKeysByOriginUrlPattern(target);

  return readies.map(row => row.imageKey);
}

function parseArgs() {
  try {
    return ArgsSchema.parse(process.argv.slice(2))[0];
  } catch (error) {
    assert(error instanceof z.ZodError);

    console.error('❌ Invalid arguments:');
    error.issues.forEach(issue => {
      console.error(`   ${issue.message}`);
    });
    console.error('Usage: node scripts/refresh-card-images.ts <imageKey | originUrlPattern>');
    process.exit(1);
  }
}

const target = parseArgs();

await refreshCardImages(target);

process.exit(0);
