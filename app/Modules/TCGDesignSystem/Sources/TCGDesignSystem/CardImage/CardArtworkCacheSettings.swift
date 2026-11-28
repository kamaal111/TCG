import KamaalExtensions
import SwiftUI
import TCGImageLoading

/// A Settings row that displays and manages saved card artwork.
public struct CardArtworkCacheSettings: View {
    private let loader = ImageLoader.shared
    @State private var artworks: [CachedImage]?
    @State private var isShowingGallery = false
    @State private var isConfirmingDeleteAll = false
    @State private var isDeleting = false
    @State private var deletionFailed = false

    public init() {}

    public var body: some View {
        CardArtworkCacheRow(byteCount: artworks?.sum(by: \.byteCount)) {
            isShowingGallery = true
        }
        .task {
            for await _ in await loader.changes() {
                await refresh()
            }
        }
        .sheet(isPresented: $isShowingGallery) { gallery }
    }

    private var gallery: some View {
        Group {
            if let artworks {
                if artworks.isEmpty {
                    ContentUnavailableView {
                        Label {
                            Text("No cached card images", bundle: .module)
                        } icon: {
                            Image(systemName: "photo.on.rectangle")
                        }
                    }
                } else {
                    artworkGrid(artworks)
                }
            } else {
                ContentUnavailableView {
                    Label {
                        Text("Couldn’t read cached card images", bundle: .module)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle")
                    }
                } actions: {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Text("Retry", bundle: .module)
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) {
                    isConfirmingDeleteAll = true
                } label: {
                    Text("Delete all cached images", bundle: .module)
                }
                .disabled(isDeleting || artworks?.isEmpty == true)
            }
        }
        .tcgSheet(
            Text("Cached card images", bundle: .module),
            closeLabel: Text("Done", bundle: .module),
            closeDisabled: false,
            onClose: { isShowingGallery = false }
        )
        .confirmationDialog(
            Text("Delete all cached images?", bundle: .module),
            isPresented: $isConfirmingDeleteAll,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                delete(nil)
            } label: {
                Text("Delete all cached images", bundle: .module)
            }
        } message: {
            Text("Card images will download again when you view them.", bundle: .module)
        }
        .alert(Text("Couldn’t delete cached images", bundle: .module), isPresented: $deletionFailed) {
            Button(role: .cancel) {
            } label: {
                Text("OK", bundle: .module)
            }
        }
        .frame(minWidth: 320, minHeight: 360)
    }

    private func artworkGrid(_ artworks: [CachedImage]) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 12, alignment: .top)], spacing: 16) {
                ForEach(artworks) { artwork in
                    VStack(spacing: 8) {
                        CachedCardArtworkThumbnail(artwork: artwork, loader: loader)
                        HStack {
                            Text(artwork.byteCount, format: .byteCount(style: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                            Button(role: .destructive) {
                                delete(artwork)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .accessibilityLabel(Text("Delete cached image", bundle: .module))
                            .disabled(isDeleting)
                        }
                        expiryMessage(for: artwork)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding()
        }
    }

    private func refresh() async {
        artworks = try? await loader.inventory()
    }

    private func delete(_ artwork: CachedImage?) {
        isDeleting = true
        Task {
            defer { isDeleting = false }
            do {
                try await loader.delete(artwork)
            } catch {
                deletionFailed = true
            }
        }
    }

    private func expiryMessage(for artwork: CachedImage) -> Text {
        artwork.expiresAt.map { date in
            Text("Expires \(date, format: .dateTime.month(.abbreviated).day().hour().minute())", bundle: .module)
        } ?? Text("No expiry", bundle: .module)
    }
}

struct CardArtworkCacheRow: View {
    let byteCount: Int64?
    let openGallery: () -> Void

    var body: some View {
        Button(action: openGallery) {
            LabeledContent {
                if let byteCount {
                    Text(byteCount, format: .byteCount(style: .file))
                } else {
                    Text("Unavailable", bundle: .module)
                }
            } label: {
                Text("Cached card images", bundle: .module)
            }
        }
    }
}

private struct CachedCardArtworkThumbnail: View {
    let artwork: CachedImage
    let loader: ImageLoader
    @State private var image: Image?

    var body: some View {
        Color.clear
            .aspectRatio(0.72, contentMode: .fit)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .overlay {
                if let image {
                    image.resizable().scaledToFit()
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityHidden(true)
            .task(id: artwork.byteCount) {
                image = await loader.thumbnail(for: artwork).map { Image(decorative: $0, scale: 1) }
            }
    }
}
