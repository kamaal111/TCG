import SwiftUI

private struct CardImageLoaderKey: EnvironmentKey {
    static let defaultValue: any CardImageLoader = URLSessionCardImageLoader()
}

extension EnvironmentValues {
    public var cardImageLoader: any CardImageLoader {
        get { self[CardImageLoaderKey.self] }
        set { self[CardImageLoaderKey.self] = newValue }
    }
}

extension View {
    /// Overrides the card artwork loader for this view hierarchy.
    ///
    /// - Example:
    ///   ```swift
    ///   ContentView().cardImageLoader(PreviewCardImageLoader(outcome: .success))
    ///   ```
    public func cardImageLoader(_ loader: any CardImageLoader) -> some View {
        environment(\.cardImageLoader, loader)
    }
}
