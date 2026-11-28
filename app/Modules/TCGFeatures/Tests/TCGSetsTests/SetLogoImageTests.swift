#if os(iOS)
    import SwiftUI
    import TCGClient
    import TCGDesignSystem
    import Testing
    import UIKit

    @testable import TCGSets

    @MainActor
    struct SetLogoImageTests {
        @Test(.timeLimit(.minutes(1)))
        func `The set row loads the logo and the checklist header falls back to the symbol`() async throws {
            let logo = try #require(URL(string: "https://images.example.com/set-logo.png"))
            let symbol = try #require(URL(string: "https://images.example.com/set-symbol.png"))
            let progress = CatalogSetProgress(collected: 0, total: 2)
            let (requests, received) = AsyncStream<URL>.makeStream()
            defer { received.finish() }
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            let controller = UIHostingController(
                rootView: VStack {
                    CatalogSetRow(
                        summary: .init(
                            set: .init(id: "with-logo", name: "Set with logo"),
                            logo: logo,
                            symbol: symbol,
                            language: "en",
                            progress: progress
                        )
                    )
                    SetChecklistHeader(
                        summary: .init(
                            set: .init(id: "with-symbol", name: "Set with symbol"),
                            logo: nil,
                            symbol: symbol,
                            language: "en",
                            progress: progress
                        ),
                        filter: .constant(.all)
                    )
                }
                .cardImageLoader(SetImageLoader(received: received))
            )
            window.rootViewController = controller
            window.isHidden = false
            controller.beginAppearanceTransition(true, animated: false)
            controller.endAppearanceTransition()
            window.layoutIfNeeded()
            defer { window.isHidden = true }

            var requested = requests.makeAsyncIterator()
            let first = try #require(await requested.next())
            let second = try #require(await requested.next())
            #expect(Set([first, second]) == Set([logo, symbol]))
        }
    }

    private struct SetImageLoader: CardImageLoader {
        let received: AsyncStream<URL>.Continuation

        func cachedImage(for url: URL) -> Image? { nil }

        func image(for url: URL) async -> Image? {
            received.yield(url)
            return Image(systemName: "photo")
        }
    }
#endif
