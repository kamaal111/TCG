import CoreGraphics
import CryptoKit
import Foundation
import KamaalLogger
import Synchronization

/// Loads remote images from memory, persistent storage, or the network.
public final class ImageLoader: Sendable {
    public static let shared = ImageLoader()

    // Keep the existing source label for App Logs filters.
    static let logger = KamaalLogger(label: "URLSessionCardImageLoader")

    private let memory: Mutex<[String: DecodedImage]> = Mutex([:])
    private let storage: ImageRequestCoordinator
    private let limiter: ImageLoadLimiter
    private let maximumDecodedImageCount: Int
    private let retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void
    let transport: Transport
    private let now: @Sendable () -> Date

    #if os(iOS)
        let backgroundCompletion = BackgroundEventCompletion()
    #endif

    private convenience init() {
        let root = URL.applicationSupportDirectory.appending(path: "CardArtwork", directoryHint: .isDirectory)
        #if os(iOS)
            let configuration = BackgroundImageTransfer.configuration()
        #else
            let configuration = URLSessionConfiguration.default
        #endif
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        let transport: Transport
        #if os(iOS)
            let directory =
                root
                .deletingLastPathComponent()
                .appending(
                    path: "RemoteImageTransfers",
                    directoryHint: .isDirectory
                )
            transport = .background(BackgroundImageTransfer(directory: directory, configuration: configuration))
        #else
            transport = .foreground(URLSession(configuration: configuration))
        #endif
        self.init(
            transport: transport,
            root: root,
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            now: Date.init,
            retryDelay: Self.waitBeforeRetry
        )
    }

    convenience init(
        session: URLSession,
        root: URL,
        maximumConcurrentLoads: Int,
        maximumDecodedImageCount: Int,
        now: @escaping @Sendable () -> Date,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) {
        self.init(
            transport: .foreground(session),
            root: root,
            maximumConcurrentLoads: maximumConcurrentLoads,
            maximumDecodedImageCount: maximumDecodedImageCount,
            now: now,
            retryDelay: retryDelay
        )
    }

    #if os(iOS)
        convenience init(
            background: any BackgroundImageTransferring,
            root: URL,
            maximumConcurrentLoads: Int,
            now: @escaping @Sendable () -> Date,
            retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
        ) {
            self.init(
                transport: .background(background),
                root: root,
                maximumConcurrentLoads: maximumConcurrentLoads,
                maximumDecodedImageCount: 128,
                now: now,
                retryDelay: retryDelay
            )
        }

        /// Reconnects the shared session when the application delegate receives background events.
        @MainActor
        public static func handleBackgroundEvents(identifier: String, completion: @escaping () -> Void) {
            guard identifier == BackgroundImageTransfer.identifier else {
                completion()
                return
            }
            let loader = shared
            loader.backgroundCompletion.register(completion)
            Task { await loader.prepareBackgroundTransfers() }
        }

        func prepareBackgroundTransfers() async {
            guard case .background(let background) = transport else { return }
            await storage.prepareBackground(background, loader: self)
        }
    #endif

    private init(
        transport: Transport,
        root: URL,
        maximumConcurrentLoads: Int,
        maximumDecodedImageCount: Int,
        now: @escaping @Sendable () -> Date,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) {
        precondition(maximumConcurrentLoads > 0, "maximumConcurrentLoads must be positive")
        self.transport = transport
        self.now = now
        self.storage = ImageRequestCoordinator(root: root, now: now)
        self.limiter = ImageLoadLimiter(maximumConcurrentLoads: maximumConcurrentLoads)
        self.maximumDecodedImageCount = maximumDecodedImageCount
        self.retryDelay = retryDelay
    }

    func cachedImage(for url: URL) -> LoadedImage? {
        cachedImage(for: url, policy: .persistent)
    }

    public func cachedImage(for url: URL, policy: ImageCachePolicy) -> LoadedImage? {
        cachedImage(forKey: Self.key(for: url), policy: policy)
    }

    func image(for url: URL) async -> LoadedImage? {
        await image(for: url, policy: .persistent)
    }

    public func image(for url: URL, policy: ImageCachePolicy) async -> LoadedImage? {
        #if os(iOS)
            await prepareBackgroundTransfers()
        #endif
        return await storage.image(for: Self.key(for: url), loader: self, url: url, policy: policy)
    }

    public func removeExpiredImages() async {
        #if os(iOS)
            await prepareBackgroundTransfers()
        #endif
        await storage.removeExpiredImages()
    }

    public func inventory() async throws -> [CachedImage] {
        try await storage.inventory()
    }

    public func changes() async -> AsyncStream<Void> {
        await storage.changes()
    }

    public func thumbnail(for artwork: CachedImage) async -> CGImage? {
        await storage.thumbnail(for: artwork)
    }

    public func delete(_ artwork: CachedImage?) async throws {
        #if os(iOS)
            await prepareBackgroundTransfers()
        #endif
        try await storage.delete(artwork, loader: self)
    }

    func cachedImage(forKey key: String, policy: ImageCachePolicy) -> LoadedImage? {
        memory.withLock { images in
            guard let entry = images[key] else { return nil }
            guard let expiresAt = entry.expiresAt else { return entry.image }
            guard now() < expiresAt else {
                images.removeValue(forKey: key)
                return nil
            }
            return policy == .temporary ? entry.image : nil
        }
    }

    func cache(_ image: LoadedImage, for key: String, expiresAt: Date?) {
        guard maximumDecodedImageCount > 0 else { return }
        memory.withLock { images in
            if images[key] == nil, images.count >= maximumDecodedImageCount,
                let firstKey = images.keys.first
            {
                images.removeValue(forKey: firstKey)
            }
            images[key] = DecodedImage(image: image, expiresAt: expiresAt)
        }
    }

    func invalidate(_ key: String?) {
        memory.withLock { images in
            if let key {
                images.removeValue(forKey: key)
            } else {
                images.removeAll()
            }
        }
    }

    enum Transport {
        case foreground(URLSession)
        #if os(iOS)
            case background(any BackgroundImageTransferring)
        #endif
    }

    func reserveRestoredTransfers(_ count: Int) async {
        await limiter.reserveRestored(count)
    }

    func download(
        _ url: URL,
        attempt: Int,
        hasPermit: Bool,
        fetch: @Sendable (Int) async throws -> (Data, URLResponse?)
    ) async -> DownloadedImage? {
        if !hasPermit { await limiter.acquire() }
        let result = await Self.loadImage(from: url, retryDelay: retryDelay, attempt: attempt, fetch: fetch)
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
        retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void,
        attempt: Int,
        fetch: @Sendable (Int) async throws -> (Data, URLResponse?)
    ) async -> DownloadedImage? {
        let maximumAttempts = 10
        let responseData: (Data, URLResponse?)
        do {
            responseData = try await fetch(attempt)
        } catch is CancellationError {
            return nil
        } catch let error as URLError where error.code == .cancelled {
            return nil
        } catch let error as URLError where error.code == .timedOut && attempt < maximumAttempts {
            await retryDelay(attempt, nil)
            return await loadImage(
                from: url,
                retryDelay: retryDelay,
                attempt: attempt + 1,
                fetch: fetch
            )
        } catch {
            logger.error(
                "Card image load failed",
                fields: [
                    .init("reason", "network", privacy: .public),
                    .init("attempts", object: attempt, privacy: .public),
                    .init("url", url.absoluteString),
                    .init("description", error.localizedDescription),
                    .init("error", String(describing: error)),
                ]
            )
            return nil
        }

        let (data, response) = responseData
        guard let response = response as? HTTPURLResponse else {
            logger.warning(
                "Card image load failed",
                fields: [
                    .init("reason", "invalid_response", privacy: .public),
                    .init("url", url.absoluteString),
                ]
            )
            return nil
        }
        if (200..<300).contains(response.statusCode) {
            guard let image = LoadedImage.decode(data) else {
                logger.warning(
                    "Card image load failed",
                    fields: [
                        .init("reason", "decode", privacy: .public),
                        .init("url", url.absoluteString),
                    ]
                )
                return nil
            }
            return DownloadedImage(image: image, data: data)
        }
        let isRetryable = response.statusCode == 429 || response.statusCode == 503
        if isRetryable, attempt < maximumAttempts {
            await retryDelay(attempt, response)
            return await loadImage(
                from: url,
                retryDelay: retryDelay,
                attempt: attempt + 1,
                fetch: fetch
            )
        }
        logger.warning(
            "Card image load failed",
            fields: [
                .init("reason", "http_status", privacy: .public),
                .init("status", "\(response.statusCode)", privacy: .public),
                .init("attempts", object: attempt, privacy: .public),
                .init("url", url.absoluteString),
            ]
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

struct DownloadedImage: Sendable {
    let image: LoadedImage
    let data: Data
}

private struct DecodedImage: Sendable {
    let image: LoadedImage
    let expiresAt: Date?
}

private actor ImageLoadLimiter {
    private var availablePermits: Int
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(maximumConcurrentLoads: Int) {
        availablePermits = maximumConcurrentLoads
    }

    func reserveRestored(_ count: Int) {
        availablePermits -= count
    }

    func acquire() async {
        if availablePermits > 0 {
            availablePermits -= 1
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        if availablePermits >= 0, let waiter = waiters.popLast() {
            waiter.resume()
            return
        }
        availablePermits += 1
    }
}
