//
//  AppVersion.swift
//  TCGFeatures
//

import Foundation

struct AppVersion: Equatable {
    let marketing: String?
    let build: String?

    static let main = AppVersion(
        marketing: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
        build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String
    )

    /// Formats the version like the system About screen, e.g. `1.0 (1)`.
    var displayText: String? {
        guard let marketing else { return nil }
        guard let build else { return marketing }

        return "\(marketing) (\(build))"
    }
}
