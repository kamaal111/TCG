import z from 'zod';

import { InfraFailure } from '../../scripts/infra/errors.ts';

const StatusSchema = z.object({
  BackendState: z.literal('Running'),
  Self: z.object({
    DNSName: z.string().nonempty(),
    Tags: z.array(z.string()).optional(),
    UserID: z.union([z.number(), z.string()]),
    TailscaleIPs: z.array(z.string()).nonempty(),
  }),
  User: z.record(z.string(), z.object({ LoginName: z.string().nonempty() })),
});

export function parseTailscaleIdentity(json: string) {
  const status = StatusSchema.safeParse(JSON.parse(json));

  if (!status.success) {
    throw new InfraFailure('Open Tailscale, sign in, connect this Mac, then rerun just setup-devportal.');
  }

  const hostname = status.data.Self.DNSName.replace(/\.$/, '');
  const login = status.data.User[String(status.data.Self.UserID)]?.LoginName;

  if (
    !/^([a-zA-Z0-9-]+\.)+ts\.net$/.test(hostname) ||
    status.data.Self.Tags?.length ||
    !login ||
    login.endsWith('@tagged-devices')
  ) {
    throw new InfraFailure(
      'Use a Mac signed into a Tailscale user account with MagicDNS enabled. Tagged devices cannot identify the operator.',
    );
  }

  return { hostname, login, address: status.data.Self.TailscaleIPs[0] };
}

const ServeSchema = z.object({
  TCP: z.record(z.string(), z.looseObject({ HTTPS: z.boolean().optional() })).optional(),
  Web: z
    .record(z.string(), z.object({ Handlers: z.record(z.string(), z.looseObject({ Proxy: z.string().optional() })) }))
    .optional(),
  AllowFunnel: z.record(z.string(), z.boolean()).optional(),
  Foreground: z.record(z.string(), z.unknown()).optional(),
});

type ServeConfiguration = z.output<typeof ServeSchema>;

export function parseServeConfiguration(json: string): ServeConfiguration {
  return ServeSchema.parse(JSON.parse(json) ?? {});
}

/** Pick an isolated HTTPS listener, preserving other Serve and Funnel handlers. */
export function portalHTTPSPort(config: ServeConfiguration, hostname: string, backendPort: number): number {
  const foreground = Object.values(config.Foreground ?? {}).map(item => ServeSchema.parse(item));
  const configurations = [config, ...foreground];

  for (const port of [443, 8443, 9443]) {
    const endpoint = `${hostname}:${port}`;
    const handlers = config.Web?.[endpoint]?.Handlers;

    const own =
      config.TCP?.[String(port)]?.HTTPS === true &&
      handlers &&
      Object.keys(handlers).length === 1 &&
      handlers['/']?.Proxy === `http://127.0.0.1:${backendPort}`;

    const publicEndpoint = configurations.some(item => {
      return Object.entries(item.AllowFunnel ?? {}).some(([host, enabled]) => host.endsWith(`:${port}`) && enabled);
    });

    const otherHostname = Object.keys(config.Web ?? {}).some(host => host !== endpoint && host.endsWith(`:${port}`));
    const otherListener = foreground.some(item => item.TCP?.[String(port)] || item.Web?.[endpoint]);
    const occupied = config.TCP?.[String(port)] || config.Web?.[endpoint];

    if (!publicEndpoint && !otherListener && !otherHostname && (!occupied || own)) {
      return port;
    }
  }

  throw new InfraFailure(
    'HTTPS ports 443, 8443 and 9443 already serve other applications or Funnel. Keep them intact; ask the tailnet administrator for a dedicated Serve listener.',
  );
}

interface PortalEndpoint {
  config: ServeConfiguration;
  hostname: string;
  backendPort: number;
  httpsPort: number;
}

export function verifyPortalServe({ config, hostname, backendPort, httpsPort }: PortalEndpoint): void {
  const endpoint = `${hostname}:${httpsPort}`;

  if (
    config.TCP?.[String(httpsPort)]?.HTTPS !== true ||
    config.Web?.[endpoint]?.Handlers['/']?.Proxy !== `http://127.0.0.1:${backendPort}` ||
    portalHTTPSPort(config, hostname, backendPort) !== httpsPort
  ) {
    throw new InfraFailure(
      'Private HTTPS could not be verified. Saved settings remain available; rerun just setup-devportal.',
    );
  }
}
