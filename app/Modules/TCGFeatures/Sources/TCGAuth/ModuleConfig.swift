//
//  ModuleConfig.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import Foundation

enum ModuleConfig {
    static let identifier = "\(Bundle.main.bundleIdentifier ?? "io.kamaal.TCG").TCGAuth"
    static let toastDismissalDelay: Duration = .seconds(3)
}
