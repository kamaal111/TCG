import assert from 'node:assert/strict';
import fs from 'node:fs';

import z from 'zod';

const PlanSchema = z.object({
  resource_changes: z
    .array(
      z.object({
        address: z.string(),
        type: z.string(),
        change: z.object({ actions: z.array(z.string()) }),
      }),
    )
    .default([]),
});

const protectedTypes = new Set(['digitalocean_droplet', 'digitalocean_database_cluster', 'digitalocean_spaces_bucket']);

try {
  const [file] = process.argv.slice(2);
  assert(file, 'Provide a Terraform JSON plan file.');
  const plan = PlanSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));

  for (const resource of plan.resource_changes) {
    assert(
      !(protectedTypes.has(resource.type) && resource.change.actions.includes('delete')),
      `Refusing deletion or replacement of protected resource ${resource.address}.`,
    );
  }

  console.log('Infrastructure plan preserves protected resources.');
} catch {
  console.error(
    'Infrastructure plan rejected: invalid plan or deletion/replacement of a Droplet, database, or bucket.',
  );
  process.exitCode = 1;
}
