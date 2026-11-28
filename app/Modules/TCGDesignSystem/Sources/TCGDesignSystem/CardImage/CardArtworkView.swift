import SwiftUI

/// Displays uncropped card artwork using the shared image cache and loader.
public struct CardArtworkView: View {
    @Environment(\.cardImageLoader) private var loader
    @Environment(\.cardArtworkCachePolicy) private var cachePolicy
    @Environment(\.retriesCardImagesOnForeground) private var retriesOnForeground
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @Environment(\.cardImageReduceMotionOverride) private var reduceMotionOverride

    private let url: URL?
    private let isThumbnail: Bool
    private var contentMode: ContentMode
    private let onLoad: (Bool) -> Void
    private var onExplore: (() -> Void)?
    private var onSizeChange: (CGSize) -> Void = { _ in }

    public init(url: URL?, onExplore: (() -> Void)?) {
        self.init(url: url, isThumbnail: false, onLoad: { _ in })
        self.onExplore = onExplore
    }

    public init(thumbnailURL: URL?) {
        self.init(url: thumbnailURL, isThumbnail: true, onLoad: { _ in })
    }

    public init(logoURL: URL) {
        self.init(thumbnailURL: logoURL)
        contentMode = .fit
    }

    init(url: URL?, isThumbnail: Bool, onLoad: @escaping (Bool) -> Void) {
        self.url = url
        self.isThumbnail = isThumbnail
        contentMode = isThumbnail ? .fill : .fit
        self.onLoad = onLoad
    }

    init(url: URL?, onLoad: @escaping (Bool) -> Void, onSizeChange: @escaping (CGSize) -> Void) {
        self.init(url: url, isThumbnail: false, onLoad: onLoad)
        self.onSizeChange = onSizeChange
    }

    public var body: some View {
        RemoteImage(
            request: url.map { ArtworkRequest(url: $0, policy: cachePolicy) },
            retriesOnForeground: retriesOnForeground,
            cachedImage: { loader.cachedImage(for: $0.url, policy: $0.policy) },
            image: { await loader.image(for: $0.url, policy: $0.policy) },
            onLoad: onLoad,
            content: { phase, retry in
                content(phase, retry: retry)
            }
        )
    }

    @ViewBuilder
    private func content(_ phase: RemoteImagePhase, retry: @escaping () -> Void) -> some View {
        switch phase {
        case .loaded(let image):
            if let onExplore {
                Button(action: onExplore) {
                    artwork(image)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Explore image", bundle: .module))
                .help(Text("Explore image", bundle: .module))
            } else {
                artwork(image)
            }
        case .loading:
            if !isThumbnail {
                VStack(spacing: 12) {
                    Image(systemName: "hourglass").font(.largeTitle)
                    Text("Loading image…", bundle: .module)
                }
                .foregroundStyle(.secondary)
            } else if reduceMotionOverride ?? accessibilityReduceMotion {
                placeholder("hourglass", color: .secondary)
            } else {
                ProgressView().controlSize(isThumbnail ? .small : .regular).tint(.secondary)
            }
        case .failed:
            if isThumbnail {
                placeholder("photo.badge.exclamationmark", color: .orange)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "photo.badge.exclamationmark").font(.largeTitle)
                    Text("Image could not be loaded.", bundle: .module)
                    Button(action: retry) {
                        Text("Retry", bundle: .module)
                    }
                }
                .foregroundStyle(.secondary)
            }
        case .missingURL:
            if isThumbnail {
                placeholder("photo", color: .secondary)
            } else {
                ContentUnavailableView {
                    Label {
                        Text("No image available", bundle: .module)
                    } icon: {
                        Image(systemName: "photo")
                    }
                }
            }
        }
    }

    private func artwork(_ image: Image) -> some View {
        image.resizable()
            .aspectRatio(contentMode: contentMode)
            .foregroundStyle(.tint)
            .onGeometryChange(for: CGSize.self) { geometry in
                geometry.size
            } action: { size in
                onSizeChange(size)
            }
    }

    private func placeholder(_ symbol: String, color: Color) -> some View {
        Image(systemName: symbol)
            .resizable()
            .scaledToFit()
            .padding(symbol == "hourglass" ? 15 : 10)
            .foregroundStyle(color)
    }

    private struct ArtworkRequest: Equatable {
        let url: URL
        let policy: CardArtworkCachePolicy
    }
}
