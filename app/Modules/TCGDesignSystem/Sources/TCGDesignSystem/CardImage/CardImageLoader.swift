import SwiftUI

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
}
