//
//  AuthTokenHeaders+Generated.swift
//  TCGClient
//

import KamaalAuth

/// Every generated operation whose response carries the credential headers.
///
/// The mapping to ``KamaalAuthClient.AuthCredentialHeaders`` lives in `KamaalAuthOpenAPI`; these three conformances
/// are the only part of it that has to live here, since the generated types only exist in this module.
extension Operations.PostAppApiAuthSignUpEmail.Output.Created.Headers: AuthTokenHeaders {}
extension Operations.PostAppApiAuthSignInEmail.Output.Ok.Headers: AuthTokenHeaders {}
extension Operations.GetAppApiAuthToken.Output.Ok.Headers: AuthTokenHeaders {}
