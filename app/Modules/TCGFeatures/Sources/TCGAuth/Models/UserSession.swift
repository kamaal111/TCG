//
//  UserSession.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import Foundation
import TCGUtils

struct UserSession: Hashable, Codable, Expirable {
    let name: String
    let email: String
    let expiresAt: Date
}
