import Testing

@testable import TCGDesignSystem

struct RemoteImageForegroundRetryTests {
    @Test
    func `A failed image gets one retry after an actual background visit`() {
        var retry = RemoteImageForegroundRetry()

        retry.sceneChanged(to: .inactive)
        retry.sceneChanged(to: .active)
        let retryAfterInterruption = retry.takeRetry()
        #expect(!retryAfterInterruption)

        retry.sceneChanged(to: .background)
        let retryInBackground = retry.takeRetry()
        #expect(!retryInBackground)

        retry.sceneChanged(to: .inactive)
        retry.sceneChanged(to: .active)
        let firstRetry = retry.takeRetry()
        let secondRetry = retry.takeRetry()
        #expect(firstRetry)
        #expect(!secondRetry)
    }

    @Test
    func `A pending request can use the foreground retry when it later fails`() {
        var retry = RemoteImageForegroundRetry()

        retry.sceneChanged(to: .background)
        retry.sceneChanged(to: .active)

        let firstRetry = retry.takeRetry()
        let secondRetry = retry.takeRetry()
        #expect(firstRetry)
        #expect(!secondRetry)
    }

    @Test
    func `A successful pending request consumes the foreground retry`() {
        var retry = RemoteImageForegroundRetry()

        retry.sceneChanged(to: .background)
        retry.sceneChanged(to: .active)
        retry.finishSuccessfully()

        let shouldRetry = retry.takeRetry()
        #expect(!shouldRetry)
    }
}
