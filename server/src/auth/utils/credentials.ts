import type { HonoContext } from '../../context.ts';

export type CredentialKind = 'bearer_jwt' | 'bearer_opaque' | 'cookie' | 'none';

export function getCredentialKind(c: HonoContext): CredentialKind {
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice(7).split('.').length === 3 ? 'bearer_jwt' : 'bearer_opaque';
  }

  return c.req.header('Cookie') == null ? 'none' : 'cookie';
}
