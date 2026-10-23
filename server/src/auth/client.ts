export interface AuthSession {
  user: { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date };
  session: { expiresAt: Date; createdAt: Date; updatedAt: Date };
}

export interface Auth {
  handler(request: Request): Promise<Response>;
  api: { getSession(options: { headers: Headers }): Promise<AuthSession | null> };
  verificationKeys(): Promise<{ id: string; publicKey: string }[]>;
}
