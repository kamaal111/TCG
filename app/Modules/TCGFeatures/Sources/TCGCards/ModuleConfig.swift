//
//  ModuleConfig.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation

enum ModuleConfig {
    static let identifier = "\(Bundle.main.bundleIdentifier ?? "io.kamaal.TCG").TCGCards"
    static let toastDismissalDelay: Duration = .seconds(3)
}
