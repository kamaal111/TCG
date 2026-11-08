import { S3Client } from '@aws-sdk/client-s3';

import { S3ObjectStorageClient } from '../s3-client.ts';

interface StorageRequest {
  hostname: string;
  headers: Record<string, string>;
}

test('signs object requests with the configured Spaces region and uses its endpoint', async () => {
  const requests: StorageRequest[] = [];

  const storage = new S3ObjectStorageClient({
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'test-card-images',
    endpoint: 'https://ams3.digitaloceanspaces.com',
    region: 'ams3',
    forcePathStyle: false,
    requestTimeoutMs: 1000,
    maxAttempts: 1,
    clientFactory: configuration => {
      return new S3Client({
        ...configuration,
        requestHandler: {
          handle: async (request: StorageRequest) => {
            requests.push(request);

            return { response: { statusCode: 200, headers: { 'content-length': '1', 'content-type': 'image/png' } } };
          },
        },
      });
    },
  });

  expect((await storage.head('card.png')).isOk()).toBe(true);
  expect(requests).toEqual([
    expect.objectContaining({
      hostname: 'test-card-images.ams3.digitaloceanspaces.com',
      headers: expect.objectContaining({
        authorization: expect.stringContaining('/ams3/s3/aws4_request'),
      }),
    }),
  ]);
});
