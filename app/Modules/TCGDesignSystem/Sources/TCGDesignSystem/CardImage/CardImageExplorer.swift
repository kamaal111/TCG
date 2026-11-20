import SwiftUI

/// Presents card artwork with bounded zoom, panning, and explicit exploration controls.
public struct CardImageExplorer: View {
    @State private var zoom = CardImageZoom()
    @State private var isLoaded = false
    @State private var viewport: CGSize = .zero
    @State private var artworkSize: CGSize = .zero
    @GestureState private var interaction: CardImageZoom.Interaction?

    private typealias ArtworkGesture = SimultaneousGesture<MagnifyGesture, DragGesture?>

    private let url: URL?

    public init(url: URL?) {
        self.url = url
    }

    public var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                artwork(in: geometry)
            }
            CardImageExplorerControls(
                scale: zoom.scale,
                isLoaded: isLoaded,
                actions: .init(
                    zoomOut: {
                        zoom.setScale(
                            zoom.scale / CardImageZoom.controlStepFactor,
                            viewport: viewport,
                            artwork: artworkSize
                        )
                    },
                    zoomIn: {
                        zoom.setScale(
                            zoom.scale * CardImageZoom.controlStepFactor,
                            viewport: viewport,
                            artwork: artworkSize
                        )
                    },
                    reset: { zoom.reset() }
                )
            )
        }
        .tcgSheet(
            Text("Explore image", bundle: .module),
            closeLabel: Text("Close", bundle: .module),
            closeDisabled: false,
            onClose: nil
        )
        .background(.background)
        .onChange(of: url) { _, _ in zoom.reset() }
        #if os(macOS)
            .frame(minWidth: 640, idealWidth: 900, minHeight: 560, idealHeight: 760)
        #endif
    }

    private func artwork(in geometry: GeometryProxy) -> some View {
        let current =
            interaction.map {
                zoom.applying($0, viewport: geometry.size, artwork: artworkSize)
            } ?? zoom
        return CardArtworkView(
            url: url,
            onLoad: { isLoaded = $0 },
            onSizeChange: { size in
                artworkSize = size
                zoom.pan(to: zoom.offset, viewport: viewport, artwork: size)
            }
        )
        .frame(width: geometry.size.width, height: geometry.size.height)
        .scaleEffect(current.scale)
        .offset(current.offset)
        .frame(width: geometry.size.width, height: geometry.size.height)
        .contentShape(Rectangle())
        .clipped()
        .gesture(
            exploreArtwork(viewport: geometry.size, artwork: artworkSize),
            isEnabled: isLoaded
        )
        .onTapGesture(count: 2) {
            guard isLoaded else { return }
            zoom.setScale(
                zoom.scale > CardImageZoom.minimumScale ? CardImageZoom.minimumScale : CardImageZoom.doubleTapScale,
                viewport: geometry.size,
                artwork: artworkSize
            )
        }
        .onChange(of: geometry.size, initial: true) { _, size in
            viewport = size
            zoom.reset()
        }
        .accessibilityLabel(Text("Card image", bundle: .module))
    }

    private func exploreArtwork(viewport: CGSize, artwork: CGSize) -> some Gesture {
        // A drag at fit scale belongs to the sheet.
        let pan = zoom.scale > CardImageZoom.minimumScale ? DragGesture() : nil
        return MagnifyGesture()
            .simultaneously(with: pan)
            .updating($interaction) { value, state, _ in
                state = Self.interaction(for: value)
            }
            .onEnded { value in
                zoom = zoom.applying(Self.interaction(for: value), viewport: viewport, artwork: artwork)
            }
    }

    private static func interaction(for value: ArtworkGesture.Value) -> CardImageZoom.Interaction {
        CardImageZoom.Interaction(
            magnification: value.first?.magnification ?? 1,
            anchor: value.first?.startAnchor ?? .center,
            translation: value.second?.translation ?? .zero
        )
    }
}
