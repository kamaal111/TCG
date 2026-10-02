import SwiftUI

/// Displays uncropped card artwork using the shared image cache and loader.
public struct CardArtworkView: View {
    @Environment(\.cardImageLoader) private var loader
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @Environment(\.cardImageReduceMotionOverride) private var reduceMotionOverride
    @State private var phase: LoadPhase
    @State private var attempt = 0

    private let url: URL?
    private let isThumbnail: Bool
    private let onLoad: (Bool) -> Void
    private var onExplore: (() -> Void)?
    private var onSizeChange: (CGSize) -> Void = { _ in }

    public init(url: URL?, onExplore: (() -> Void)? = nil) {
        self.init(url: url, isThumbnail: false)
        self.onExplore = onExplore
    }

    init(url: URL?, isThumbnail: Bool = false, onLoad: @escaping (Bool) -> Void = { _ in }) {
        self.url = url
        self.isThumbnail = isThumbnail
        self.onLoad = onLoad
        _phase = State(initialValue: url == nil ? .missingURL : .loading)
    }

    init(url: URL?, onLoad: @escaping (Bool) -> Void, onSizeChange: @escaping (CGSize) -> Void) {
        self.init(url: url, isThumbnail: false, onLoad: onLoad)
        self.onSizeChange = onSizeChange
    }

    public var body: some View {
        content
            .task(id: LoadRequest(url: url, attempt: attempt)) {
                onLoad(false)
                guard let url else {
                    phase = .missingURL
                    return
                }
                if let image = loader.cachedImage(for: url) {
                    phase = .loaded(image)
                    onLoad(true)
                    return
                }
                phase = .loading
                let image = await loader.image(for: url)
                guard !Task.isCancelled else { return }
                phase = image.map(LoadPhase.loaded) ?? .failed
                onLoad(image != nil)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loaded(let image):
            if let onExplore {
                Button(action: onExplore) {
                    artwork(image)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Explore image", bundle: .module))
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
                    Button {
                        attempt += 1
                    } label: {
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
            .aspectRatio(contentMode: isThumbnail ? .fill : .fit)
            .foregroundStyle(.tint)
            .onGeometryChange(for: CGSize.self) { geometry in
                geometry.size
            } action: { size in
                onSizeChange(size)
            }
    }

    private func placeholder(_ symbol: String, color: Color) -> some View {
        Image(systemName: symbol).resizable().scaledToFit()
            .padding(symbol == "hourglass" ? 15 : 10).foregroundStyle(color)
    }

    private enum LoadPhase {
        case loading
        case loaded(Image)
        case failed
        case missingURL
    }

    private struct LoadRequest: Equatable {
        let url: URL?
        let attempt: Int
    }
}
