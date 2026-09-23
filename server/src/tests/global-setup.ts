import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

const GARAGE_IMAGE = 'dxflrs/garage:v2.4.1';

const POSTGRES_IMAGE = 'postgres:18';

const POSTGRES_DATABASE = 'tcg';

const POSTGRES_USER = 'tcg_user';

const POSTGRES_PASSWORD = 'tcg_password';

const ACCESS_KEY_ID = 'GK0E6CA7DF3BA4C6B0A244';

const SECRET_ACCESS_KEY = 'd4f4c2d8d5ee4dd1acf59d3354e3ca7e371fd086313a37d1d1ed0ea968f48fc8';

const REGION = 'us-east-1';

const GARAGE_CONFIG = `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "lmdb"

replication_factor = 1
consistency_mode = "consistent"

rpc_bind_addr = "[::]:3901"
rpc_secret = "f1ca139823a6cfd8af7376c7fe15905c9b7ca37d285524a7af6a0e5a81f80dec"

[s3_api]
s3_region = "us-east-1"
api_bind_addr = "[::]:3900"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "f77ba9b019735eb79da2fdd33ff2053d8e32a95ca5fbb19dbef6fc61ac8a770b"
`;

export interface TestObjectStorageConnection {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
    objectStorage: TestObjectStorageConnection;
  }
}

let container: StartedTestContainer | undefined = undefined;

let postgresContainer: StartedTestContainer | undefined = undefined;

export async function setup(project: TestProject) {
  try {
    postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: POSTGRES_DATABASE,
        POSTGRES_USER,
        POSTGRES_PASSWORD,
      })
      .withExposedPorts(5432)
      .withHealthCheck({ test: ['CMD-SHELL', `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DATABASE}`] })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();

    project.provide(
      'databaseUrl',
      `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(5432)}/${POSTGRES_DATABASE}`,
    );

    container = await new GenericContainer(GARAGE_IMAGE)
      .withCommand(['/garage', '-c', '/etc/garage.toml', 'server'])
      .withCopyContentToContainer([{ content: GARAGE_CONFIG, target: '/etc/garage.toml' }])
      .withExposedPorts(3900)
      .withWaitStrategy(Wait.forLogMessage('S3 API server listening'))
      .start();

    const status = await garage('status');
    const nodeID = status.stdout.match(/^(?<id>\S+).*NO ROLE ASSIGNED/m)?.groups?.id;

    if (nodeID === undefined) {
      throw new Error(`Garage did not report an unassigned node:\n${status.output}`);
    }

    await garage('layout', 'assign', '-z', 'test', '-c', '1G', nodeID);
    await garage('layout', 'apply', '--version', '1');
    await garage('key', 'import', '-n', 'tcg-test', '--yes', ACCESS_KEY_ID, SECRET_ACCESS_KEY);
    await garage('key', 'allow', '--create-bucket', ACCESS_KEY_ID);

    const connection = {
      endpoint: `http://${container.getHost()}:${container.getMappedPort(3900)}`,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: REGION,
    };

    project.provide('objectStorage', connection);
  } catch (error) {
    await Promise.allSettled([container?.stop(), postgresContainer?.stop()]);
    container = undefined;
    postgresContainer = undefined;
    throw error;
  }
}

export async function teardown() {
  try {
    await Promise.all([container?.stop(), postgresContainer?.stop()]);
  } finally {
    container = undefined;
    postgresContainer = undefined;
  }
}

async function garage(...args: string[]) {
  if (container === undefined) {
    throw new Error('Garage container was not started');
  }

  const result = await container.exec(['/garage', '-c', '/etc/garage.toml', ...args]);

  if (result.exitCode !== 0) {
    throw new Error(`Garage command failed: ${args.join(' ')}\n${result.output}`);
  }

  return result;
}
