import { imageKeyForOriginURL, proxyURLForOriginURL, storageKeyForImageKey } from '../keys.ts';

describe('card image keys', () => {
  test('uses a stable sha256 key and sharded storage path', () => {
    const originURL = 'https://cdn.example.com/cards/1.png';
    const key = imageKeyForOriginURL(originURL);

    expect(key).toBe('be4a788218080174c971ab0609618bb99adc181b359970f635015732541b3bf0');
    expect(storageKeyForImageKey(key)).toBe(`card-images/be/4a/${key}`);
    expect(proxyURLForOriginURL(originURL)).toBe(`http://localhost:8080/app-api/images/${key}`);
  });
});
