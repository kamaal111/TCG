import SwiftUI

enum RemoteImagePhase {
    case loading
    case loaded(Image)
    case failed
    case missingURL
}

/// Owns the image request while the caller supplies its presentation.
struct RemoteImage<Request: Equatable, Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: RemoteImagePhase = .loading
    @State private var currentRequest: Request?
    @State private var isVisible = false
    @State private var requestNumber = 0
    @State private var foregroundRetry = RemoteImageForegroundRetry()

    let request: Request?
    let loads: Bool
    let retriesOnForeground: Bool
    let cachedImage: (Request) -> Image?
    let image: (Request) async -> Image?
    let onLoad: (Bool) -> Void
    let onSettled: (() -> Void)?
    @ViewBuilder let content: (RemoteImagePhase, @escaping () -> Void) -> Content

    var body: some View {
        content(displayedPhase, { requestNumber += 1 })
            .task(id: Attempt(request: request, number: requestNumber, loads: loads)) {
                guard loads else { return }
                await load()
            }
            .onAppear { isVisible = true }
            .onDisappear {
                isVisible = false
                foregroundRetry = RemoteImageForegroundRetry()
            }
            .onChange(of: scenePhase) { _, phase in
                guard isVisible, retriesOnForeground else { return }
                foregroundRetry.sceneChanged(to: phase)
                retryAfterFailureIfNeeded()
            }
    }

    private var displayedPhase: RemoteImagePhase {
        guard let request else { return .missingURL }
        if !loads {
            return cachedImage(request).map(RemoteImagePhase.loaded) ?? .loading
        }
        return currentRequest == request ? phase : .loading
    }

    private func load() async {
        guard !Task.isCancelled else { return }
        onLoad(false)
        currentRequest = request
        guard let request else { return }
        if let cached = cachedImage(request) {
            phase = .loaded(cached)
            foregroundRetry.finishSuccessfully()
            onLoad(true)
            onSettled?()
            return
        }
        phase = .loading
        let image = await self.image(request)
        guard !Task.isCancelled, currentRequest == request else { return }
        if let image {
            phase = .loaded(image)
            foregroundRetry.finishSuccessfully()
            onLoad(true)
        } else {
            phase = .failed
            retryAfterFailureIfNeeded()
        }
        onSettled?()
    }

    private func retryAfterFailureIfNeeded() {
        guard isVisible, case .failed = displayedPhase, foregroundRetry.takeRetry() else { return }
        phase = .loading
        requestNumber += 1
    }

    private struct Attempt: Equatable {
        let request: Request?
        let number: Int
        let loads: Bool
    }
}

struct RemoteImageForegroundRetry {
    private var didEnterBackground = false
    private var canRetry = false

    mutating func sceneChanged(to phase: ScenePhase) {
        switch phase {
        case .background:
            didEnterBackground = true
            canRetry = false
        case .active:
            if didEnterBackground {
                canRetry = true
                didEnterBackground = false
            }
        case .inactive:
            break
        @unknown default:
            break
        }
    }

    mutating func takeRetry() -> Bool {
        let shouldRetry = canRetry
        canRetry = false
        return shouldRetry
    }

    mutating func finishSuccessfully() {
        canRetry = false
    }
}
