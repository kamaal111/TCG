//
//  ModuleConfig.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation

enum ModuleConfig {
    static let identifier = "\(Bundle.main.bundleIdentifier!).TCGClient"
    static let credentialsKeychainKey = "\(identifier).credentials"
}
