import CoreGraphics
import SwiftUI

/// A deterministic, zero-I/O card image loader for previews and snapshots.
///
/// - Example:
///   ```swift
///   let loader = PreviewCardImageLoader(outcome: .success)
///   ```
public struct PreviewCardImageLoader: CardImageLoader {
    /// Result returned by the preview loader.
    ///
    /// - Example:
    ///   ```swift
    ///   let outcome = PreviewCardImageLoader.Outcome.failure
    ///   ```
    public enum Outcome: Sendable {
        case success
        case failure
        case loading
    }

    private let outcome: Outcome

    /// Creates a preview loader with a fixed result.
    ///
    /// - Example:
    ///   ```swift
    ///   let loader = PreviewCardImageLoader(outcome: .loading)
    ///   ```
    public init(outcome: Outcome) {
        self.outcome = outcome
    }

    public func cachedImage(for url: URL) -> Image? {
        guard outcome == .success else { return nil }
        return StableURLImage.make(for: url)
    }

    public func image(for url: URL) async -> Image? {
        cachedImage(for: url)
    }
}

private enum StableURLImage {
    static func make(for url: URL) -> Image? {
        // FNV-1a's 64-bit offset basis starts the deterministic URL hash.
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in url.absoluteString.utf8 {
            hash ^= UInt64(byte)
            // FNV-1a's 64-bit prime; `&*=` intentionally wraps on overflow.
            hash &*= 1_099_511_628_211
        }
        let red = CGFloat((hash >> 16) & 0xff) / 255
        let green = CGFloat((hash >> 8) & 0xff) / 255
        let blue = CGFloat(hash & 0xff) / 255
        guard
            let context = CGContext(
                data: nil,
                width: 1,
                height: 1,
                bitsPerComponent: 8,
                bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else { return nil }
        context.setFillColor(CGColor(red: red, green: green, blue: blue, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard let image = context.makeImage() else { return nil }
        return Image(decorative: image, scale: 1)
    }
}
