#if os(iOS)
    import TCGImageLoading
    import UIKit

    public final class TCGApplicationDelegate: NSObject, UIApplicationDelegate {
        public func application(
            _ application: UIApplication,
            handleEventsForBackgroundURLSession identifier: String,
            completionHandler: @escaping () -> Void
        ) {
            ImageLoader.handleBackgroundEvents(identifier: identifier, completion: completionHandler)
        }
    }
#endif
