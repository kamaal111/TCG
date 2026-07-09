import type { AuthResponse, BetterAuthSignUpOrSignInResponse } from './auth/schemas/responses.ts';

export function mapSignUpOrSignInBetterAuthRequestToAuthResponse(
  betterAuthResponse: BetterAuthSignUpOrSignInResponse,
): AuthResponse {
  return {
    token: betterAuthResponse.token,
    user: {
      id: betterAuthResponse.user.id,
      email: betterAuthResponse.user.email,
      name: betterAuthResponse.user.name,
      created_at: betterAuthResponse.user.createdAt,
      email_verified: betterAuthResponse.user.emailVerified,
    },
  };
}
