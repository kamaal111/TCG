import SwiftUI

/// Displays card artwork with a deterministic placeholder and asynchronous loading.
public struct CardImageView: View {
    private static let thumbnailSize = CGSize(width: 44, height: 61)
    private let url: URL?
    private let size: CGSize

    public init(url: URL?) {
        self.init(url: url, size: Self.thumbnailSize)
    }

    public init(url: URL?, size: CGSize) {
        self.url = url
        self.size = size
    }

    public var body: some View {
        CardArtworkView(url: url, isThumbnail: true)
            .frame(width: size.width, height: size.height)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)
    }
}

private struct CardImageReduceMotionOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

extension EnvironmentValues {
    var cardImageReduceMotionOverride: Bool? {
        get { self[CardImageReduceMotionOverrideKey.self] }
        set { self[CardImageReduceMotionOverrideKey.self] = newValue }
    }
}
