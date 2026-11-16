import SwiftUI

private struct CardImageLoaderKey: EnvironmentKey {
    static let defaultValue: any CardImageLoader = URLSessionCardImageLoader.shared
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

private struct CardArtworkCachePolicyKey: EnvironmentKey {
    static let defaultValue: CardArtworkCachePolicy = .collection
}

extension EnvironmentValues {
    var cardArtworkCachePolicy: CardArtworkCachePolicy {
        get { self[CardArtworkCachePolicyKey.self] }
        set { self[CardArtworkCachePolicyKey.self] = newValue }
    }
}

extension View {
    public func cardArtworkCachePolicy(_ policy: CardArtworkCachePolicy) -> some View {
        environment(\.cardArtworkCachePolicy, policy)
    }

    public func maintainCardArtworkCache() -> some View {
        modifier(CardArtworkCacheMaintenance())
    }
}

private struct CardArtworkCacheMaintenance: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.task(id: scenePhase) {
            guard scenePhase == .active else { return }

            let loader = URLSessionCardImageLoader.shared
            while !Task.isCancelled {
                await loader.removeExpiredArtwork()
                do {
                    // Space out disk scans while the app stays active. Cache reads enforce
                    // the 24-hour expiry even before the next scan removes the file.
                    try await Task.sleep(for: .seconds(3_600))
                } catch {
                    return
                }
            }
        }
    }
}
