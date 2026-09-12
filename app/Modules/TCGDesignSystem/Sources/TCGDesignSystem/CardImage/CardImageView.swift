import SwiftUI

/// Displays card artwork with a deterministic placeholder and asynchronous loading.
///
/// - Example:
///   ```swift
///   CardImageView(url: URL(string: "https://example.com/card.png"))
///   ```
public struct CardImageView: View {
    private let url: URL?
    @Environment(\.cardImageLoader) private var loader
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @Environment(\.cardImageReduceMotionOverride) private var reduceMotionOverride
    @State private var imageLoadState: ImageLoadState

    /// Creates a fixed-aspect card thumbnail for the supplied URL.
    ///
    /// - Example:
    ///   ```swift
    ///   CardImageView(url: card.imageURL)
    ///   ```
    public init(url: URL?) {
        self.url = url
        _imageLoadState = State(initialValue: url == nil ? .missingURL : .loading)
    }

    public var body: some View {
        Group {
            switch imageLoadState {
            case .loaded(let image):
                image
                    .resizable()
                    .scaledToFill()
                    .foregroundStyle(.tint)
            case .loading:
                if reduceMotion {
                    Image(systemName: "hourglass")
                        .resizable()
                        .scaledToFit()
                        .padding(15)
                        .foregroundStyle(.secondary)
                } else {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.secondary)
                }
            case .failed:
                Image(systemName: "photo.badge.exclamationmark")
                    .resizable()
                    .scaledToFit()
                    .padding(10)
                    .foregroundStyle(.orange)
            case .missingURL:
                Image(systemName: "photo")
                    .resizable()
                    .scaledToFit()
                    .padding(10)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 44, height: 61)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: url) {
            guard let url else {
                imageLoadState = .missingURL
                return
            }
            if let image = loader.cachedImage(for: url) {
                imageLoadState = .loaded(image)
                return
            }
            imageLoadState = .loading
            let image = await loader.image(for: url)
            guard !Task.isCancelled else { return }
            imageLoadState = image.map(ImageLoadState.loaded) ?? .failed
        }
        .accessibilityHidden(true)
    }

    private enum ImageLoadState {
        case loading
        case loaded(Image)
        case failed
        case missingURL
    }

    private var reduceMotion: Bool {
        reduceMotionOverride ?? accessibilityReduceMotion
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
