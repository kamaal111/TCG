//
//  CachedUserSession.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import Foundation

struct CachedUserSession: Codable {
    let session: UserSession
    let cachedAt: Date
}
