import net from 'node:net';

import z from 'zod';

import { failure } from './errors.ts';

const SizeSchema = z.object({
  slug: z.string(),
  description: z.string(),
  vcpus: z.number(),
  memory: z.number(),
  disk: z.number(),
  price_monthly: z.number(),
  regions: z.array(z.string()),
  available: z.boolean(),
});

const DropletSchema = z.object({
  id: z.number(),
  name: z.string(),
  region: z.object({ slug: z.string() }),
  size: SizeSchema,
  disk: z.number(),
  vpc_uuid: z.string().nullish(),
});

const DatabaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  engine: z.string(),
  region: z.string(),
  size: z.string(),
  version: z.string(),
  num_nodes: z.number(),
  private_network_uuid: z.string().nullish(),
});

const VpcSchema = z.object({ id: z.string(), name: z.string(), region: z.string() });

const RegionSchema = z.object({ slug: z.string(), name: z.string(), available: z.boolean() });

const LinksSchema = z.object({ pages: z.object({ next: z.string().optional() }).optional() }).optional();

const OptionsSchema = z.object({
  options: z.object({
    pg: z.object({
      regions: z.array(z.string()),
      versions: z.array(z.string()),
      layouts: z.array(z.object({ num_nodes: z.number(), sizes: z.array(z.string()) })),
    }),
  }),
});

type Size = z.infer<typeof SizeSchema>;

type Droplet = z.infer<typeof DropletSchema>;

type Database = z.infer<typeof DatabaseSchema>;

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

function hint(value: string, saved: string, running: string): string | undefined {
  return [value === saved ? 'saved' : '', value === running ? 'running' : ''].filter(Boolean).join(', ') || undefined;
}

function cpu(count: number): string {
  return `${count} ${count === 1 ? 'CPU' : 'CPUs'}`;
}

function memory(megabytes: number): string {
  return megabytes < 1024 ? `${megabytes} MB` : `${megabytes / 1024} GB`;
}

export function dropletSizeChoices({
  sizes,
  saved,
  running,
  region,
  disk,
}: {
  sizes: readonly Size[];
  saved: string;
  running: string;
  region: string;
  disk: number;
}): Choice[] {
  const choices = sizes
    .filter(size => {
      return (
        size.slug === saved ||
        size.slug === running ||
        (size.available && size.regions.includes(region) && size.disk >= disk)
      );
    })
    .toSorted((a, b) => a.price_monthly - b.price_monthly)
    .map(size => ({
      value: size.slug,
      label: `${size.description} — ${cpu(size.vcpus)}, ${memory(size.memory)} RAM, ${size.disk} GB disk — $${size.price_monthly}/month`,
      hint: hint(size.slug, saved, running),
    }));

  for (const value of new Set([saved, running])) {
    if (value && !choices.some(choice => choice.value === value)) {
      choices.push({
        value,
        label: value === saved ? 'Saved plan — details unavailable' : 'Running plan — details unavailable',
        hint: hint(value, saved, running),
      });
    }
  }

  return choices;
}

function databaseLabel(slug: string): string | undefined {
  const match = /^(db-s|db-intel|db-amd|gd|so1_5)-(\d+)vcpu-(\d+)gb$/.exec(slug);

  const families = new Map([
    ['db-s', 'Regular'],
    ['db-intel', 'Premium Intel'],
    ['db-amd', 'Premium AMD'],
    ['gd', 'General purpose'],
    ['so1_5', 'Storage optimized'],
  ]);

  const family = families.get(match?.[1] ?? '');

  if (!family || !match?.[2] || !match[3]) {
    return undefined;
  }

  return `${family} — ${cpu(Number(match[2]))}, ${match[3]} GB RAM`;
}

export function databaseSizeChoices({
  slugs,
  saved,
  running,
}: {
  slugs: readonly string[];
  saved: string;
  running: string;
}): Choice[] {
  const choices: Choice[] = [];

  for (const value of new Set([...slugs, saved, running])) {
    if (!value) {
      continue;
    }

    const label = databaseLabel(value);

    if (!label && value !== saved && value !== running) {
      continue;
    }

    choices.push({
      value,
      label: label ?? (value === saved ? 'Saved plan — details unavailable' : 'Running plan — details unavailable'),
      hint: hint(value, saved, running),
    });
  }

  return choices;
}

export class DigitalOcean {
  private readonly token: string;
  private readonly request: typeof fetch;

  constructor({ token, request = fetch }: { token: string; request?: typeof fetch }) {
    this.token = token;
    this.request = request;
  }

  private async get<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    let response: Response;

    try {
      response = await this.request(`https://api.digitalocean.com/v2/${endpoint}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      return failure('DigitalOcean could not be reached. Retry or keep saved settings.');
    }

    if (!response.ok) {
      return failure(
        `DigitalOcean lookup failed (${response.status}). Check token permissions, then retry or keep saved settings.`,
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      return failure('DigitalOcean returned unsupported resource details. Retry or keep saved settings.');
    }

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return failure('DigitalOcean returned unsupported resource details. Retry or keep saved settings.');
    }

    return parsed.data;
  }

  private async pages<T>(endpoint: string, schema: z.ZodType<{ items: T[]; more: boolean }>): Promise<T[]> {
    const items: T[] = [];

    for (let page = 1; ; page++) {
      const result = await this.get(`${endpoint}?per_page=200&page=${page}`, schema);
      items.push(...result.items);

      if (!result.more) {
        return items;
      }

      if (page >= 100) {
        failure('DigitalOcean returned too many pages. Narrow the account resources before continuing.');
      }
    }
  }

  async droplets(): Promise<Droplet[]> {
    return this.pages(
      'droplets',
      z
        .object({ droplets: z.array(DropletSchema), links: LinksSchema })
        .transform(value => ({ items: value.droplets, more: Boolean(value.links?.pages?.next) })),
    );
  }

  async databases(): Promise<Database[]> {
    const databases = await this.pages(
      'databases',
      z
        .object({ databases: z.array(DatabaseSchema), links: LinksSchema })
        .transform(value => ({ items: value.databases, more: Boolean(value.links?.pages?.next) })),
    );

    return databases.filter(database => database.engine === 'pg');
  }

  async vpcs() {
    return this.pages(
      'vpcs',
      z
        .object({ vpcs: z.array(VpcSchema), links: LinksSchema })
        .transform(value => ({ items: value.vpcs, more: Boolean(value.links?.pages?.next) })),
    );
  }

  async regions() {
    return this.pages(
      'regions',
      z
        .object({ regions: z.array(RegionSchema), links: LinksSchema })
        .transform(value => ({ items: value.regions, more: Boolean(value.links?.pages?.next) })),
    );
  }

  async sizes(): Promise<Size[]> {
    return this.pages(
      'sizes',
      z
        .object({ sizes: z.array(SizeSchema), links: LinksSchema })
        .transform(value => ({ items: value.sizes, more: Boolean(value.links?.pages?.next) })),
    );
  }

  async databaseOptions() {
    return (await this.get('databases/options', OptionsSchema)).options.pg;
  }

  async logicalDatabases(id: string): Promise<Choice[]> {
    const databases = await this.pages(
      `databases/${encodeURIComponent(id)}/dbs`,
      z
        .object({ dbs: z.array(z.object({ name: z.string() })), links: LinksSchema })
        .transform(value => ({ items: value.dbs, more: Boolean(value.links?.pages?.next) })),
    );

    return databases.map(database => ({ value: database.name, label: database.name }));
  }

  async trustedClients({ database, droplet }: { database: string; droplet: number }): Promise<string[]> {
    const result = await this.get(
      `databases/${encodeURIComponent(database)}/firewall`,
      z.object({ rules: z.array(z.object({ type: z.string(), value: z.string() })) }),
    );

    const clients: string[] = [];

    for (const rule of result.rules) {
      if (rule.type === 'droplet' && rule.value === String(droplet)) {
        continue;
      }

      const address = rule.value.replace(/\/32$/, '');

      if (rule.type !== 'ip_addr' || net.isIP(address) !== 4 || address === '0.0.0.0') {
        failure(
          'Existing database trusted sources include rules this configuration cannot preserve. Keep the resource file unchanged and review those rules manually.',
        );
      }

      clients.push(address);
    }

    return [...new Set(clients)];
  }
}
