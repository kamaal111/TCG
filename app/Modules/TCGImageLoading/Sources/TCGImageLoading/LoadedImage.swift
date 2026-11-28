import Foundation

#if os(iOS)
    import UIKit

    public typealias PlatformImage = UIImage
#elseif os(macOS)
    import AppKit

    public typealias PlatformImage = NSImage
#endif

/// An image decoded with the platform's native decoder.
public struct LoadedImage: Sendable {
    public let platformImage: PlatformImage

    static func decode(_ data: Data) -> Self? {
        #if os(iOS)
            UIImage(data: data).map(Self.init(platformImage:))
        #elseif os(macOS)
            NSImage(data: data).map(Self.init(platformImage:))
        #endif
    }
}
