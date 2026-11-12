import { sha256Hex } from './sha256.ts';

describe('sha256Hex', () => {
  test.each(['abc', Uint8Array.of(97, 98, 99)])('returns the SHA-256 hex digest of %j', input => {
    expect(sha256Hex(input)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
