import { Client } from 'pg';

export async function withDeploymentDatabase<T>(
  connectionString: string,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });

  try {
    await client.connect();

    return await operation(client);
  } finally {
    await client.end();
  }
}
