import SwiftUI

/// Presents card artwork with bounded zoom, panning, and explicit exploration controls.
public struct CardImageExplorer: View {
    @Environment(\.dismiss) private var dismiss
    @State private var zoom = CardImageZoom()
    @State private var isLoaded = false
    @State private var viewport: CGSize = .zero
    @State private var artworkSize: CGSize = .zero
    @GestureState private var magnification: CGFloat = 1
    @GestureState private var translation: CGSize = .zero

    private let url: URL?

    public init(url: URL?) {
        self.url = url
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Explore image", bundle: .module).font(.headline)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Close", bundle: .module)
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            GeometryReader { geometry in
                let current = effectiveZoom(viewport: geometry.size, artwork: artworkSize)
                CardArtworkView(
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
                .gesture(magnify(viewport: geometry.size, artwork: artworkSize), including: isLoaded ? .all : .none)
                .simultaneousGesture(
                    drag(viewport: geometry.size, artwork: artworkSize), including: isLoaded ? .all : .none
                )
                .onTapGesture(count: 2) {
                    guard isLoaded else { return }
                    zoom.setScale(zoom.scale > 1 ? 1 : 2, viewport: geometry.size, artwork: artworkSize)
                }
                .onChange(of: geometry.size, initial: true) { _, size in
                    viewport = size
                    zoom.reset()
                }
                .accessibilityLabel(Text("Card image", bundle: .module))

            }
            CardImageExplorerControls(
                scale: zoom.scale,
                isLoaded: isLoaded,
                actions: .init(
                    zoomOut: { zoom.setScale(zoom.scale / 1.5, viewport: viewport, artwork: artworkSize) },
                    zoomIn: { zoom.setScale(zoom.scale * 1.5, viewport: viewport, artwork: artworkSize) },
                    reset: { zoom.reset() }
                )
            )
        }
        .background(.background)
        .onChange(of: url) { _, _ in zoom.reset() }
        #if os(macOS)
            .frame(minWidth: 640, idealWidth: 900, minHeight: 560, idealHeight: 760)
        #endif
    }

    private func effectiveZoom(viewport: CGSize, artwork: CGSize) -> CardImageZoom {
        var current = zoom
        current.setScale(zoom.scale * magnification, viewport: viewport, artwork: artwork)
        current.pan(
            to: CGSize(width: zoom.offset.width + translation.width, height: zoom.offset.height + translation.height),
            viewport: viewport,
            artwork: artwork
        )
        return current
    }

    private func magnify(viewport: CGSize, artwork: CGSize) -> some Gesture {
        MagnifyGesture()
            .updating($magnification) { value, state, _ in state = value.magnification }
            .onEnded { value in
                zoom.setScale(zoom.scale * value.magnification, viewport: viewport, artwork: artwork)
            }
    }

    private func drag(viewport: CGSize, artwork: CGSize) -> some Gesture {
        DragGesture()
            .updating($translation) { value, state, _ in state = value.translation }
            .onEnded { value in
                zoom.pan(
                    to: CGSize(
                        width: zoom.offset.width + value.translation.width,
                        height: zoom.offset.height + value.translation.height
                    ),
                    viewport: viewport,
                    artwork: artwork
                )
            }
    }
}
