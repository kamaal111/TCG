//
//  ModuleConfig.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation

enum ModuleConfig {
    static let bundleIdentifier = Bundle.main.bundleIdentifier ?? "io.kamaal.TCG"
    static let identifier = "\(bundleIdentifier).TCGClient"

    static func storageNamespace(server: ServerConfiguration, bundleIdentifier: String) -> String {
        "\(bundleIdentifier).server.\(server.origin)"
    }
}
