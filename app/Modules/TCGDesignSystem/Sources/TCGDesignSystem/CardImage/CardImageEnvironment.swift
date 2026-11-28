import SwiftUI
import TCGImageLoading

private struct CardImageLoading {
    let loader: any CardImageLoader
    let retriesOnForeground: Bool
}

private struct CardImageLoaderKey: EnvironmentKey {
    static let defaultValue: CardImageLoading = {
        #if os(iOS)
            CardImageLoading(loader: SharedCardImageLoader(), retriesOnForeground: true)
        #else
            CardImageLoading(loader: SharedCardImageLoader(), retriesOnForeground: false)
        #endif
    }()
}

extension EnvironmentValues {
    public var cardImageLoader: any CardImageLoader {
        get { self[CardImageLoaderKey.self].loader }
        set { self[CardImageLoaderKey.self] = CardImageLoading(loader: newValue, retriesOnForeground: false) }
    }

    var retriesCardImagesOnForeground: Bool { self[CardImageLoaderKey.self].retriesOnForeground }
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

            let loader = ImageLoader.shared
            while !Task.isCancelled {
                await loader.removeExpiredImages()
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
