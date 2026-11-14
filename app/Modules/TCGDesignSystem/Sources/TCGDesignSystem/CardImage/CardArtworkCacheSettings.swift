import SwiftUI

/// A Settings row that displays and manages saved card artwork.
public struct CardArtworkCacheSettings: View {
    private let loader = URLSessionCardImageLoader.shared
    @State private var artworks: [CachedCardArtwork]?
    @State private var isShowingGallery = false
    @State private var isConfirmingDeleteAll = false
    @State private var isDeleting = false
    @State private var deletionFailed = false

    public init() {}

    public var body: some View {
        CardArtworkCacheRow(byteCount: artworks?.reduce(0) { $0 + $1.byteCount }) {
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
        NavigationStack {
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
            .navigationTitle(Text("Cached card images", bundle: .module))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        isShowingGallery = false
                    } label: {
                        Text("Done", bundle: .module)
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(role: .destructive) {
                        isConfirmingDeleteAll = true
                    } label: {
                        Text("Delete all cached images", bundle: .module)
                    }
                    .disabled(isDeleting || artworks?.isEmpty == true)
                }
            }
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
        }
        .frame(minWidth: 320, minHeight: 360)
    }

    private func artworkGrid(_ artworks: [CachedCardArtwork]) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 12)], spacing: 16) {
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
                    }
                }
            }
            .padding()
        }
    }

    private func refresh() async {
        artworks = try? await loader.inventory()
    }

    private func delete(_ artwork: CachedCardArtwork?) {
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
    let artwork: CachedCardArtwork
    let loader: URLSessionCardImageLoader
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
                image = await loader.thumbnail(for: artwork)
            }
    }
}
