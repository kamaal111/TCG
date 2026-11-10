import { portalHTTPSPort, parseTailscaleIdentity, verifyPortalServe, parseServeConfiguration } from './tailscale.ts';

const hostname = 'release.example.ts.net';

const identity = {
  BackendState: 'Running',
  Self: { DNSName: `${hostname}.`, UserID: 1, TailscaleIPs: ['100.64.0.10'] },
  User: { '1': { LoginName: 'operator@example.com' } },
};

const portal = {
  TCP: { '443': { HTTPS: true } },
  Web: { [`${hostname}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } } },
};

test('detects the signed-in user and removes the trailing DNS dot', () => {
  expect(parseTailscaleIdentity(JSON.stringify(identity))).toEqual({
    hostname,
    login: 'operator@example.com',
    address: '100.64.0.10',
  });
});

test.each([
  { ...identity, BackendState: 'NeedsLogin' },
  { ...identity, Self: { ...identity.Self, DNSName: 'release.local' } },
  { ...identity, Self: { ...identity.Self, Tags: ['tag:server'] } },
  { ...identity, User: {} },
])('rejects disconnected, non-Tailscale and tagged identities: %j', value => {
  expect(() => parseTailscaleIdentity(JSON.stringify(value))).toThrow(/Tailscale/);
});

test.each([{}, null])('chooses standard HTTPS for an unconfigured host: %j', config => {
  expect(portalHTTPSPort(parseServeConfiguration(JSON.stringify(config)), hostname, 8787)).toBe(443);
});

test('reuses only the exact private portal listener', () => {
  expect(portalHTTPSPort(parseServeConfiguration(JSON.stringify(portal)), hostname, 8787)).toBe(443);
});

test.each([
  { TCP: { '443': { TCPForward: 'localhost:1234' } } },
  { ...portal, AllowFunnel: { [`${hostname}:443`]: true } },
  { Foreground: { session: portal } },
  {
    ...portal,
    Web: {
      [`${hostname}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' }, '/other': { Text: 'Keep me' } } },
    },
  },
])('preserves existing services, extra handlers and public endpoints: %j', config => {
  const before = JSON.stringify(config);
  expect(portalHTTPSPort(parseServeConfiguration(JSON.stringify(config)), hostname, 8787)).toBe(8443);
  expect(JSON.stringify(config)).toBe(before);
});

test('refuses setup when every supported listener belongs to another service', () => {
  expect(() => portalHTTPSPort({ TCP: { '443': {}, '8443': {}, '9443': {} } }, hostname, 8787)).toThrow(
    'already serve other applications',
  );
});

test('verification rejects a public listener even when its backend is correct', () => {
  expect(() => {
    return verifyPortalServe({
      config: parseServeConfiguration(JSON.stringify({ ...portal, AllowFunnel: { [`${hostname}:443`]: true } })),
      hostname,
      backendPort: 8787,
      httpsPort: 443,
    });
  }).toThrow('could not be verified');
});

test('verification rejects a configuration that did not apply the requested proxy', () => {
  expect(() => verifyPortalServe({ config: {}, hostname, backendPort: 8787, httpsPort: 443 })).toThrow(
    'could not be verified',
  );
});
