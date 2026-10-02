import SwiftUI

/// Displays card artwork with a deterministic placeholder and asynchronous loading.
public struct CardImageView: View {
    private let url: URL?

    public init(url: URL?) {
        self.url = url
    }

    public var body: some View {
        CardArtworkView(url: url, isThumbnail: true)
            .frame(width: 44, height: 61)
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
