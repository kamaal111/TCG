import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
public final class TCGPricePrivacy {
    public var hidePrices: Bool {
        didSet { defaults?.set(hidePrices, forKey: Self.preferenceKey) }
    }
    private let defaults: UserDefaults?
    private static let preferenceKey = "TCG.privacy.hidePrices"

    public init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        hidePrices = defaults?.bool(forKey: Self.preferenceKey) ?? false
    }
}

extension EnvironmentValues {
    @Entry public var tcgPricePrivacy: TCGPricePrivacy?
}
