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

    private let memory: Mutex<[String: DecodedArtwork]> = Mutex([:])
    private let storage: CardArtworkStorage
    private let limiter: ImageLoadLimiter
    private let maximumDecodedImageCount: Int
    private let retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void
    private let session: URLSession
    private let now: @Sendable () -> Date

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
            now: Date.init,
            retryDelay: Self.waitBeforeRetry
        )
    }

    init(
        session: URLSession,
        root: URL,
        maximumConcurrentLoads: Int,
        maximumDecodedImageCount: Int,
        now: @escaping @Sendable () -> Date,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) {
        precondition(maximumConcurrentLoads > 0, "maximumConcurrentLoads must be positive")
        self.session = session
        self.now = now
        self.storage = CardArtworkStorage(root: root, now: now)
        self.limiter = ImageLoadLimiter(maximumConcurrentLoads: maximumConcurrentLoads)
        self.maximumDecodedImageCount = maximumDecodedImageCount
        self.retryDelay = retryDelay
    }

    func cachedImage(for url: URL) -> Image? {
        cachedImage(for: url, policy: .collection)
    }

    func cachedImage(for url: URL, policy: CardArtworkCachePolicy) -> Image? {
        cachedImage(forKey: Self.key(for: url), policy: policy)
    }

    func image(for url: URL) async -> Image? {
        await image(for: url, policy: .collection)
    }

    func image(for url: URL, policy: CardArtworkCachePolicy) async -> Image? {
        await storage.image(for: Self.key(for: url), loader: self, url: url, policy: policy)
    }

    func removeExpiredArtwork() async {
        await storage.removeExpiredArtwork()
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

    func delete(_ artwork: CachedCardArtwork?) async throws {
        try await storage.delete(artwork, loader: self)
    }

    fileprivate func cachedImage(forKey key: String, policy: CardArtworkCachePolicy) -> Image? {
        memory.withLock { images in
            guard let entry = images[key] else { return nil }
            guard let expiresAt = entry.expiresAt else { return entry.image }
            guard now() < expiresAt else {
                images.removeValue(forKey: key)
                return nil
            }
            return policy == .search ? entry.image : nil
        }
    }

    fileprivate func cache(_ image: Image, for key: String, expiresAt: Date?) {
        guard maximumDecodedImageCount > 0 else { return }
        memory.withLock { images in
            if images[key] == nil, images.count >= maximumDecodedImageCount,
                let firstKey = images.keys.first
            {
                images.removeValue(forKey: firstKey)
            }
            images[key] = DecodedArtwork(image: image, expiresAt: expiresAt)
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
        let result = await Self.loadImage(from: url, session: session, retryDelay: retryDelay, attempt: 1)
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
        attempt: Int
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

private struct DecodedArtwork: Sendable {
    let image: Image
    let expiresAt: Date?
}

private actor CardArtworkStorage {
    private static let searchLifetime: TimeInterval = 86_400
    private static let fileKeys: Set<URLResourceKey> = [.fileSizeKey, .isRegularFileKey, .contentModificationDateKey]

    private let root: URL
    private let now: @Sendable () -> Date
    private var inFlight: [String: Load] = [:]
    private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

    init(root: URL, now: @escaping @Sendable () -> Date) {
        self.root = root
        self.now = now
    }

    func image(
        for key: String,
        loader: URLSessionCardImageLoader,
        url: URL,
        policy: CardArtworkCachePolicy
    ) async -> Image? {
        if let image = loader.cachedImage(forKey: key, policy: policy) { return image }
        if let load = inFlight[key] {
            if policy == .collection { inFlight[key]?.policy = .collection }
            return await load.task.value
        }
        if let image = readImage(for: key, loader: loader, policy: policy) { return image }

        let id = UUID()
        let task = Task<Image?, Never> {
            let artwork = await loader.download(url)
            guard let load = inFlight[key], load.id == id else { return artwork?.image }
            defer { inFlight.removeValue(forKey: key) }
            guard let artwork else { return nil }

            do {
                let expiry = try save(artwork.data, for: key, policy: load.policy)
                if load.policy == .collection || expiry != nil {
                    loader.cache(artwork.image, for: key, expiresAt: expiry)
                }
                notifyObservers()
            } catch {
                logger.warning("Could not save downloaded card artwork: \(error.localizedDescription)")
            }
            return artwork.image
        }
        inFlight[key] = Load(id: id, task: task, policy: policy)
        return await task.value
    }

    private func readImage(for key: String, loader: URLSessionCardImageLoader, policy: CardArtworkCachePolicy)
        -> Image?
    {
        let collectionFile = file(for: key, policy: .collection)
        if let image = decodeFile(collectionFile) {
            loader.cache(image, for: key, expiresAt: nil)
            return image
        }

        let searchFile = file(for: key, policy: .search)
        guard let expiry = expiration(of: searchFile), now() < expiry,
            let image = decodeFile(searchFile)
        else { return nil }

        if policy == .collection {
            do {
                try promote(searchFile, to: collectionFile)
                loader.cache(image, for: key, expiresAt: nil)
                notifyObservers()
                return image
            } catch {
                logger.warning("Could not retain collection card artwork: \(error.localizedDescription)")
            }
        }
        loader.cache(image, for: key, expiresAt: expiry)
        return image
    }

    private func promote(_ source: URL, to destination: URL) throws {
        try prepareDirectory(for: .collection)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: source)
        } else {
            try FileManager.default.moveItem(at: source, to: destination)
        }
    }

    private func save(_ data: Data, for key: String, policy: CardArtworkCachePolicy) throws -> Date? {
        let destination = file(for: key, policy: policy)
        try prepareDirectory(for: policy)
        try data.write(to: destination, options: .atomic)
        guard policy == .search else { return nil }

        try FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: destination.path)
        return expiration(of: destination)
    }

    private func decodeFile(_ url: URL) -> Image? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return PlatformImageDecoder.decode(data)
    }

    func removeExpiredArtwork() {
        _ = try? freshSearchFiles()
    }

    private func freshSearchFiles() throws -> [URL] {
        var fresh: [URL] = []
        var removed = false
        let time = now()
        for file in try artworkFiles(for: .search) {
            if isFresh(file, at: time) {
                fresh.append(file)
                continue
            }
            do {
                try FileManager.default.removeItem(at: file)
                removed = true
            } catch {
                logger.warning("Could not remove expired card artwork: \(error.localizedDescription)")
            }
        }
        if removed { notifyObservers() }
        return fresh
    }

    func inventory() throws -> [CachedCardArtwork] {
        var artwork: [String: CachedCardArtwork] = [:]
        for url in try freshSearchFiles() {
            let cached = try inventoryEntry(for: url)
            artwork[cached.id] = cached
        }
        for url in try artworkFiles(for: .collection) {
            let cached = try inventoryEntry(for: url)
            artwork[cached.id] = cached
        }
        return artwork.values.sorted { $0.id < $1.id }
    }

    private func inventoryEntry(for url: URL) throws -> CachedCardArtwork {
        let values = try url.resourceValues(forKeys: Self.fileKeys)
        return CachedCardArtwork(id: url.lastPathComponent, byteCount: Int64(values.fileSize ?? 0))
    }

    private func artworkFiles(for policy: CardArtworkCachePolicy) throws -> [URL] {
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(
                at: directory(for: policy),
                includingPropertiesForKeys: Array(Self.fileKeys),
                options: .skipsHiddenFiles
            )
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return []
        }
        return try files.filter { try $0.resourceValues(forKeys: Self.fileKeys).isRegularFile == true }
    }

    private func expiration(of url: URL) -> Date? {
        let values = try? url.resourceValues(forKeys: Self.fileKeys)
        return values?.contentModificationDate?.addingTimeInterval(Self.searchLifetime)
    }

    private func isFresh(_ url: URL, at time: Date) -> Bool {
        guard let expiry = expiration(of: url) else { return false }
        return time < expiry
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
        let collectionFile = file(for: artwork.id, policy: .collection)
        let searchFile = file(for: artwork.id, policy: .search)
        let searchSource = { () -> CGImageSource? in
            guard self.isFresh(searchFile, at: self.now()) else { return nil }
            return CGImageSourceCreateWithURL(searchFile as CFURL, nil)
        }
        guard let source = CGImageSourceCreateWithURL(collectionFile as CFURL, nil) ?? searchSource() else {
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
        if let key {
            var deletionError: (any Error)?
            for policy: CardArtworkCachePolicy in [.collection, .search] {
                do {
                    try removeItemIfPresent(at: file(for: key, policy: policy))
                } catch {
                    deletionError = error
                }
            }
            if let deletionError { throw deletionError }
        } else {
            try removeItemIfPresent(at: root)
        }
    }

    private func removeItemIfPresent(at url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch let error as CocoaError
            where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile
        {
            return
        }
    }

    private func prepareDirectory(for policy: CardArtworkCachePolicy) throws {
        var directory = directory(for: policy)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
    }

    private func directory(for policy: CardArtworkCachePolicy) -> URL {
        switch policy {
        case .collection: root.appending(path: "collection", directoryHint: .isDirectory)
        case .search: root
        }
    }

    private func file(for key: String, policy: CardArtworkCachePolicy) -> URL {
        directory(for: policy).appending(path: key, directoryHint: .notDirectory)
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
        var policy: CardArtworkCachePolicy
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
