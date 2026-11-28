import SwiftUI

/// Displays card artwork with a deterministic placeholder and asynchronous loading.
public struct CardImageView: View {
    private static let thumbnailSize = CGSize(width: 44, height: 61)
    private let url: URL?
    private let size: CGSize
    private let priority: CardImageRequestPriority
    private let loads: Bool
    private let onSettled: (() -> Void)?

    public init(url: URL?) {
        self.init(url: url, size: Self.thumbnailSize)
    }

    public init(url: URL?, size: CGSize) {
        self.init(url: url, size: size, priority: .standard, loads: true, onSettled: nil)
    }

    public init(url: URL?, priority: CardImageRequestPriority) {
        self.init(url: url, size: Self.thumbnailSize, priority: priority, loads: true, onSettled: nil)
    }

    public init(
        url: URL?,
        size: CGSize,
        priority: CardImageRequestPriority,
        loads: Bool,
        onSettled: (() -> Void)?
    ) {
        self.url = url
        self.size = size
        self.priority = priority
        self.loads = loads
        self.onSettled = onSettled
    }

    public var body: some View {
        CardArtworkView(thumbnailURL: url, priority: priority, loads: loads, onSettled: onSettled)
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
