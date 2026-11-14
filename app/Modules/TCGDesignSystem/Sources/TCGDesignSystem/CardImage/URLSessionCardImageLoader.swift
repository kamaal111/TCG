import CryptoKit
import Foundation
import ImageIO
import KamaalLogger
import SwiftUI
import Synchronization

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

private let logger = KamaalLogger(from: URLSessionCardImageLoader.self)

/// Loads card artwork from memory, persistent storage, or the network.
final class URLSessionCardImageLoader: CardImageLoader {
    static let shared = URLSessionCardImageLoader()

    private let memory: Mutex<[String: Image]> = Mutex([:])
    private let storage: CardArtworkStorage
    private let limiter: ImageLoadLimiter
    private let maximumDecodedImageCount: Int
    private let retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void
    private let session: URLSession

    private convenience init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        self.init(
            session: URLSession(configuration: configuration),
            root: URL.applicationSupportDirectory.appending(
                path: "CardArtwork",
                directoryHint: .isDirectory
            ),
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            retryDelay: Self.waitBeforeRetry
        )
    }

    init(
        session: URLSession,
        root: URL,
        maximumConcurrentLoads: Int,
        maximumDecodedImageCount: Int,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) {
        precondition(maximumConcurrentLoads > 0, "maximumConcurrentLoads must be positive")
        self.session = session
        self.storage = CardArtworkStorage(root: root)
        self.limiter = ImageLoadLimiter(maximumConcurrentLoads: maximumConcurrentLoads)
        self.maximumDecodedImageCount = maximumDecodedImageCount
        self.retryDelay = retryDelay
    }

    func cachedImage(for url: URL) -> Image? {
        cachedImage(forKey: Self.key(for: url))
    }

    func image(for url: URL) async -> Image? {
        let key = Self.key(for: url)
        return await storage.image(for: key, loader: self, url: url)
    }

    func inventory() async throws -> [CachedCardArtwork] {
        try await storage.inventory()
    }

    func changes() async -> AsyncStream<Void> {
        await storage.changes()
    }

    func thumbnail(for artwork: CachedCardArtwork) async -> Image? {
        await storage.thumbnail(for: artwork)
    }

    func delete(_ artwork: CachedCardArtwork? = nil) async throws {
        try await storage.delete(artwork, loader: self)
    }

    fileprivate func cachedImage(forKey key: String) -> Image? {
        memory.withLock { $0[key] }
    }

    fileprivate func cache(_ image: Image, for key: String) {
        guard maximumDecodedImageCount > 0 else { return }
        memory.withLock { images in
            if images.count >= maximumDecodedImageCount, let firstKey = images.keys.first {
                images.removeValue(forKey: firstKey)
            }
            images[key] = image
        }
    }

    fileprivate func invalidate(_ key: String?) {
        memory.withLock { images in
            if let key {
                images.removeValue(forKey: key)
            } else {
                images.removeAll()
            }
        }
    }

    fileprivate func download(_ url: URL) async -> DownloadedCardArtwork? {
        await limiter.acquire()
        let result = await Self.loadImage(from: url, session: session, retryDelay: retryDelay)
        await limiter.release()
        return result
    }

    static func key(for url: URL) -> String {
        SHA256.hash(data: Data(url.absoluteString.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func loadImage(
        from url: URL,
        session: URLSession,
        retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void,
        attempt: Int = 1
    ) async -> DownloadedCardArtwork? {
        let maximumAttempts = 10
        var responseData: (Data, URLResponse)
        do {
            responseData = try await session.data(from: url)
        } catch is CancellationError {
            return nil
        } catch let error as URLError where error.code == .cancelled {
            return nil
        } catch let error as URLError where error.code == .timedOut && attempt < maximumAttempts {
            await retryDelay(attempt, nil)
            return await loadImage(
                from: url,
                session: session,
                retryDelay: retryDelay,
                attempt: attempt + 1
            )
        } catch {
            logger.error(
                label:
                    "Card image load failed; reason=network; attempts=\(attempt); url=\(url.absoluteString)",
                error: error
            )
            return nil
        }

        let (data, response) = responseData
        guard let response = response as? HTTPURLResponse else {
            logger.warning("Card image load failed; reason=invalid_response; url=\(url.absoluteString)")
            return nil
        }
        if (200..<300).contains(response.statusCode) {
            guard let image = PlatformImageDecoder.decode(data) else {
                logger.warning("Card image load failed; reason=decode; url=\(url.absoluteString)")
                return nil
            }
            return DownloadedCardArtwork(image: image, data: data)
        }
        let isRetryable = response.statusCode == 429 || response.statusCode == 503
        if isRetryable, attempt < maximumAttempts {
            await retryDelay(attempt, response)
            return await loadImage(
                from: url,
                session: session,
                retryDelay: retryDelay,
                attempt: attempt + 1
            )
        }
        logger.warning(
            "Card image load failed; reason=http_status; status=\(response.statusCode); attempts=\(attempt); url=\(url.absoluteString)"
        )
        return nil
    }

    private static func waitBeforeRetry(attempt: Int, response: HTTPURLResponse?) async {
        let retryAfter = response?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
        let exponentialDelay = pow(2, Double(attempt - 1))
        let delay = min(retryAfter ?? exponentialDelay, 5)
        try? await Task.sleep(for: .milliseconds(Int64(delay * 1_000)))
    }
}

struct CachedCardArtwork: Identifiable, Sendable {
    let id: String
    let byteCount: Int64
}

private struct DownloadedCardArtwork: Sendable {
    let image: Image
    let data: Data
}

private actor CardArtworkStorage {
    private let root: URL
    private var inFlight: [String: Load] = [:]
    private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

    init(root: URL) {
        self.root = root
    }

    func image(for key: String, loader: URLSessionCardImageLoader, url: URL) async -> Image? {
        if let image = loader.cachedImage(forKey: key) { return image }
        if let load = inFlight[key] { return await load.task.value }
        if let data = try? Data(contentsOf: file(for: key)),
            let image = PlatformImageDecoder.decode(data)
        {
            loader.cache(image, for: key)
            return image
        }

        let id = UUID()
        let task = Task<Image?, Never> {
            let artwork = await loader.download(url)
            guard inFlight[key]?.id == id else { return artwork?.image }
            defer { inFlight.removeValue(forKey: key) }
            guard let artwork else { return nil }

            do {
                try save(artwork.data, for: key)
                loader.cache(artwork.image, for: key)
                notifyObservers()
            } catch {
                logger.warning("Could not save downloaded card artwork: \(error.localizedDescription)")
            }
            return artwork.image
        }
        inFlight[key] = Load(id: id, task: task)
        return await task.value
    }

    func inventory() throws -> [CachedCardArtwork] {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .isRegularFileKey]
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: Array(keys),
                options: .skipsHiddenFiles
            )
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return []
        }
        let artwork: [CachedCardArtwork] = try files.compactMap { url in
            let values = try url.resourceValues(forKeys: keys)
            guard values.isRegularFile == true, let bytes = values.fileSize else { return nil }
            return CachedCardArtwork(id: url.lastPathComponent, byteCount: Int64(bytes))
        }
        return artwork.sorted { $0.id < $1.id }
    }

    func changes() -> AsyncStream<Void> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeObserver(id) }
        }
        continuation.yield(())
        return stream
    }

    func thumbnail(for artwork: CachedCardArtwork) -> Image? {
        guard let source = CGImageSourceCreateWithURL(file(for: artwork.id) as CFURL, nil) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 320,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return Image(decorative: image, scale: 1)
    }

    func delete(_ artwork: CachedCardArtwork?, loader: URLSessionCardImageLoader) throws {
        let key = artwork?.id
        loader.invalidate(key)
        if let key {
            inFlight.removeValue(forKey: key)
        } else {
            inFlight.removeAll()
        }

        defer { notifyObservers() }
        do {
            try FileManager.default.removeItem(at: key.map(file(for:)) ?? root)
        } catch let error as CocoaError
            where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile
        {
            return
        }
    }

    private func save(_ data: Data, for key: String) throws {
        var directory = root
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
        try data.write(to: file(for: key), options: .atomic)
    }

    private func file(for key: String) -> URL {
        root.appending(path: key, directoryHint: .notDirectory)
    }

    private func notifyObservers() {
        for observer in observers.values {
            observer.yield(())
        }
    }

    private func removeObserver(_ id: UUID) {
        observers.removeValue(forKey: id)
    }

    private struct Load {
        let id: UUID
        let task: Task<Image?, Never>
    }
}

private actor ImageLoadLimiter {
    private var availablePermits: Int
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(maximumConcurrentLoads: Int) {
        availablePermits = maximumConcurrentLoads
    }

    func acquire() async {
        if availablePermits > 0 {
            availablePermits -= 1
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        if let waiter = waiters.popLast() {
            waiter.resume()
            return
        }
        availablePermits += 1
    }
}

private enum PlatformImageDecoder {
    static func decode(_ data: Data) -> Image? {
        #if canImport(UIKit)
            guard let image = UIImage(data: data) else { return nil }
            return Image(uiImage: image)
        #elseif canImport(AppKit)
            guard let image = NSImage(data: data) else { return nil }
            return Image(nsImage: image)
        #else
            return nil
        #endif
    }
}
