import Foundation
import KamaalLogger
import SwiftUI
import Synchronization

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

private let logger = KamaalLogger(from: URLSessionCardImageLoader.self)

/// Loads card images with URLSession caching and a bounded decoded-image cache.
///
/// - Example:
///   ```swift
///   let loader = URLSessionCardImageLoader()
///   let image = await loader.image(for: url)
///   ```
final class URLSessionCardImageLoader: CardImageLoader {
    private let cache: Mutex<[URL: Image]>
    private let inFlight: Mutex<[URL: InFlightImageLoad]>
    private let limiter: ImageLoadLimiter
    private let maximumDecodedImageCount: Int
    private let retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void
    private let session: URLSession

    convenience init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(
            memoryCapacity: ModuleConfig.cardImageURLCacheMemoryCapacity,
            diskCapacity: ModuleConfig.cardImageURLCacheDiskCapacity
        )
        configuration.requestCachePolicy = .useProtocolCachePolicy
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        self.init(
            session: URLSession(configuration: configuration),
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            retryDelay: Self.waitBeforeRetry
        )
    }

    init(
        session: URLSession,
        maximumConcurrentLoads: Int,
        maximumDecodedImageCount: Int,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) {
        precondition(maximumConcurrentLoads > 0, "maximumConcurrentLoads must be positive")
        self.session = session
        self.limiter = ImageLoadLimiter(maximumConcurrentLoads: maximumConcurrentLoads)
        self.maximumDecodedImageCount = maximumDecodedImageCount
        self.cache = Mutex([:])
        self.inFlight = Mutex([:])
        self.retryDelay = retryDelay
    }

    func cachedImage(for url: URL) -> Image? {
        cache.withLock { $0[url] }
    }

    func image(for url: URL) async -> Image? {
        if let cached = cachedImage(for: url) {
            return cached
        }

        let load = inFlight.withLock { tasks in
            if let existing = tasks[url] {
                return existing
            }

            let identifier = UUID()
            let task = Task.detached { [limiter, retryDelay, session] in
                await limiter.acquire()
                let image = await Self.loadImage(from: url, session: session, retryDelay: retryDelay)
                await limiter.release()

                return image
            }
            let load = InFlightImageLoad(identifier: identifier, task: task)
            tasks[url] = load

            return load
        }
        let image = await load.task.value
        inFlight.withLock { tasks in
            guard tasks[url]?.identifier == load.identifier else { return }

            tasks.removeValue(forKey: url)
        }
        guard let image else { return nil }

        cacheImage(image, for: url)

        return image
    }

    private func cacheImage(_ image: Image, for url: URL) {
        cache.withLock { images in
            if images.count >= maximumDecodedImageCount, let firstKey = images.keys.first {
                images.removeValue(forKey: firstKey)
            }
            images[url] = image
        }
    }

    private static func loadImage(
        from url: URL,
        session: URLSession,
        retryDelay: @Sendable (Int, HTTPURLResponse?) async -> Void,
        attempt: Int = 1
    ) async -> Image? {
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
                label: "Card image load failed; reason=network; attempts=\(attempt); url=\(url.absoluteString)",
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
            return image
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

private struct InFlightImageLoad {
    let identifier: UUID
    let task: Task<Image?, Never>
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
