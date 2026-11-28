#if os(iOS)
    import SwiftUI
    import TCGDesignSystem
    import Testing
    import UIKit

    @testable import TCGSearch

    @MainActor
    struct SearchArtworkCollageTests {
        @Test(.timeLimit(.minutes(1)), arguments: [true, false])
        func `Four tile artwork starts with the lead and fills in after it settles`(succeeds: Bool) async throws {
            let urls = try Self.imageURLs(for: "result")
            let (requests, received) = AsyncStream<URL>.makeStream()
            let loader = CollageImageLoader(blocked: [urls[0]], received: received)
            let window = Self.mount(urls: urls, loader: loader)
            defer {
                window.isHidden = true
                received.finish()
            }

            var requested = requests.makeAsyncIterator()
            #expect(await requested.next() == urls[0])
            #expect(await loader.requestedURLs == [urls[0]])
            await loader.resolve(urls[0], succeeds: succeeds)

            let second = try #require(await requested.next())
            let third = try #require(await requested.next())
            let fourth = try #require(await requested.next())
            #expect(Set([second, third, fourth]) == Set(urls.dropFirst()))
        }

        @Test(.timeLimit(.minutes(1)))
        func `Replacing a collage ignores the old lead completion`() async throws {
            let original = try Self.imageURLs(for: "original")
            let replacement = try Self.imageURLs(for: "replacement")
            let (requests, received) = AsyncStream<URL>.makeStream()
            let loader = CollageImageLoader(blocked: [original[0], replacement[0]], received: received)
            let window = Self.mount(urls: original, loader: loader)
            defer {
                window.isHidden = true
                received.finish()
            }

            var requested = requests.makeAsyncIterator()
            #expect(await requested.next() == original[0])
            let controller = try #require(window.rootViewController as? UIHostingController<LoadedCollage>)
            controller.rootView = LoadedCollage(urls: replacement, loader: loader)
            window.layoutIfNeeded()
            #expect(await requested.next() == replacement[0])

            await loader.resolve(original[0], succeeds: true)
            #expect(await loader.requestedURLs == [original[0], replacement[0]])
            await loader.resolve(replacement[0], succeeds: true)
            let second = try #require(await requested.next())
            let third = try #require(await requested.next())
            let fourth = try #require(await requested.next())
            #expect(Set([second, third, fourth]) == Set(replacement.dropFirst()))
        }

        private static func imageURLs(for result: String) throws -> [URL] {
            try (1...4).map { index in
                try #require(URL(string: "https://images.example.com/\(result)-\(index).png"))
            }
        }

        private static func mount(urls: [URL], loader: CollageImageLoader) -> UIWindow {
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            let controller = UIHostingController(rootView: LoadedCollage(urls: urls, loader: loader))
            window.rootViewController = controller
            window.isHidden = false
            controller.beginAppearanceTransition(true, animated: false)
            controller.endAppearanceTransition()
            window.layoutIfNeeded()
            return window
        }

        private struct LoadedCollage: View {
            let urls: [URL]
            let loader: CollageImageLoader

            var body: some View {
                SearchArtworkCollage(urls: urls).cardImageLoader(loader)
            }
        }
    }

    private actor CollageImageLoader: CardImageLoader {
        let blocked: Set<URL>
        let received: AsyncStream<URL>.Continuation
        private var waiting: [URL: CheckedContinuation<Bool, Never>] = [:]
        private(set) var requestedURLs: [URL] = []

        init(blocked: Set<URL>, received: AsyncStream<URL>.Continuation) {
            self.blocked = blocked
            self.received = received
        }

        nonisolated func cachedImage(for url: URL) -> Image? { nil }

        func image(for url: URL) async -> Image? {
            requestedURLs.append(url)
            guard blocked.contains(url) else {
                received.yield(url)
                return Image(systemName: "photo")
            }
            let succeeds = await withCheckedContinuation { continuation in
                waiting[url] = continuation
                received.yield(url)
            }
            return succeeds ? Image(systemName: "photo") : nil
        }

        func resolve(_ url: URL, succeeds: Bool) {
            waiting.removeValue(forKey: url)?.resume(returning: succeeds)
        }
    }
#endif
