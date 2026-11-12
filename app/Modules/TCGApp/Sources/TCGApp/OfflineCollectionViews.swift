import ImageIO
import SwiftUI
import TCGCards
import TCGDesignSystem

struct OfflineCollectionSettings: View {
    @Bindable var download: OfflineCollection

    var body: some View {
        Section {
            Picker(selection: $download.policy) {
                Text("Wi-Fi and manual", bundle: .module).tag(OfflineCollection.Policy.wifi)
                Text("Any connection", bundle: .module).tag(OfflineCollection.Policy.anyConnection)
                Text("Manual only", bundle: .module).tag(OfflineCollection.Policy.manual)
            } label: {
                Text("Automatic sync", bundle: .module)
            }

            if let progress = download.progress {
                ProgressView(value: progress) {
                    Text("Downloading collection…", bundle: .module)
                }
            }
            if let lastSync = download.lastSync {
                LabeledContent {
                    Text(lastSync, format: .dateTime.year().month().day().hour().minute())
                } label: {
                    Text("Last successful sync", bundle: .module)
                }
            }
            if download.missingImages > 0 {
                LabeledContent {
                    Text(download.missingImages, format: .number)
                } label: {
                    Text("Cards without a downloaded image", bundle: .module)
                }
            }
            if download.requiresDeviceSecurity {
                Text("Set up a device passcode or password to download your collection.", bundle: .module)
                    .foregroundStyle(.red)
            }
            if download.failed {
                Text("Couldn’t update the offline collection.", bundle: .module).foregroundStyle(.red)
            }

            Button(action: download.sync) {
                if download.hasDownload {
                    Text("Sync now", bundle: .module)
                } else {
                    Text("Download now", bundle: .module)
                }
            }
            .disabled(download.progress != nil)

            if download.hasDownload {
                OfflineCollectionOpenButton(download: download)
            }
            if download.hasDownload || download.hasPendingDownload || download.progress != nil || download.failed {
                Button(role: .destructive, action: download.removeDownload) {
                    Text("Remove download", bundle: .module)
                }
            }
        } header: {
            Text("Offline collection", bundle: .module)
        }
    }
}

struct OfflineCollectionOpenButton: View {
    let download: OfflineCollection

    var body: some View {
        VStack {
            Button {
                Task {
                    await download.open(reason: String(localized: "Unlock your downloaded collection", bundle: .module))
                }
            } label: {
                Text("Open offline collection", bundle: .module)
            }
            if download.unlockFailed {
                Text("Couldn’t unlock the offline collection.", bundle: .module).foregroundStyle(.red)
            }
        }
    }
}

struct OfflineCollectionBrowser: View {
    let download: OfflineCollection
    let snapshot: OfflineCollectionSnapshot

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Offline collection", bundle: .module).font(.headline)
                Spacer()
                Button(action: download.close) { Text("Done", bundle: .module) }
                Button(role: .destructive, action: download.removeDownload) {
                    Text("Remove download", bundle: .module)
                }
            }
            .padding()
            Divider()
            TCGDownloadedCollectionScreen(cards: snapshot.cards, collections: snapshot.collections)
                .id(snapshot.etag)
                .cardImageLoader(DownloadedArtworkLoader(download: download))
        }
    }
}

private struct DownloadedArtworkLoader: CardImageLoader {
    let download: OfflineCollection

    nonisolated func cachedImage(for url: URL) -> Image? { nil }

    nonisolated func image(for url: URL) async -> Image? {
        guard let file = await download.imageFile(for: url),
            let source = CGImageSourceCreateWithURL(file as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        return Image(decorative: image, scale: 1)
    }
}
