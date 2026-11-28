import SwiftUI
import TCGImageLoading

public enum CardArtworkCachePolicy: Sendable {
    case collection
    case search

    fileprivate var imageCachePolicy: ImageCachePolicy {
        switch self {
        case .collection: .persistent
        case .search: .temporary
        }
    }
}

/// Loads and caches decoded card artwork for ``CardImageView``.
///
/// - Example:
///   ```swift
///   let image = await loader.image(for: URL(string: "https://example.com/card.png")!)
///   ```
public protocol CardImageLoader: Sendable {
    /// Returns an already-decoded image without performing I/O.
    ///
    /// - Example:
    ///   ```swift
    ///   let cached = loader.cachedImage(for: url)
    ///   ```
    func cachedImage(for url: URL) -> Image?

    /// Loads and decodes an image, returning `nil` when it cannot be loaded.
    ///
    /// - Example:
    ///   ```swift
    ///   let image = await loader.image(for: url)
    ///   ```
    func image(for url: URL) async -> Image?

    func cachedImage(for url: URL, policy: CardArtworkCachePolicy) -> Image?

    func image(for url: URL, policy: CardArtworkCachePolicy) async -> Image?
}

extension CardImageLoader {
    public func cachedImage(for url: URL, policy: CardArtworkCachePolicy) -> Image? {
        cachedImage(for: url)
    }

    public func image(for url: URL, policy: CardArtworkCachePolicy) async -> Image? {
        await image(for: url)
    }
}

/// Converts the shared image service's platform images into SwiftUI images.
struct SharedCardImageLoader: CardImageLoader {
    func cachedImage(for url: URL) -> Image? {
        cachedImage(for: url, policy: .collection)
    }

    func image(for url: URL) async -> Image? {
        await image(for: url, policy: .collection)
    }

    func cachedImage(for url: URL, policy: CardArtworkCachePolicy) -> Image? {
        ImageLoader.shared.cachedImage(for: url, policy: policy.imageCachePolicy).map(Self.makeImage)
    }

    func image(for url: URL, policy: CardArtworkCachePolicy) async -> Image? {
        await ImageLoader.shared.image(for: url, policy: policy.imageCachePolicy).map(Self.makeImage)
    }

    private static func makeImage(_ image: LoadedImage) -> Image {
        #if os(iOS)
            Image(uiImage: image.platformImage)
        #elseif os(macOS)
            Image(nsImage: image.platformImage)
        #endif
    }
}
