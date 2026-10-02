import SwiftUI

#if os(iOS)
    import UIKit

    struct TCGCardFormDismissalObserver: UIViewControllerRepresentable {
        @Environment(\.colorScheme) private var colorScheme
        let isDismissalDisabled: Bool
        let onAttempt: () -> Void

        func makeUIViewController(context: Context) -> ObserverController {
            let controller = ObserverController(isDismissalDisabled: isDismissalDisabled, onAttempt: onAttempt)
            controller.overrideUserInterfaceStyle = colorScheme == .dark ? .dark : .light
            return controller
        }

        func updateUIViewController(_ controller: ObserverController, context: Context) {
            controller.onAttempt = onAttempt
            controller.isDismissalDisabled = isDismissalDisabled
            controller.overrideUserInterfaceStyle = colorScheme == .dark ? .dark : .light
            // SwiftUI can install its presentation delegate after attaching the child.
            Task { @MainActor [weak controller] in controller?.observePresentation() }
        }

        static func dismantleUIViewController(_ controller: ObserverController, coordinator: Void) {
            controller.stopObserving()
        }

        final class ObserverController: UIViewController, UIAdaptivePresentationControllerDelegate {
            var isDismissalDisabled: Bool
            var onAttempt: () -> Void
            private weak var observedPresentation: UIPresentationController?
            private var previousDelegate: (any UIAdaptivePresentationControllerDelegate)?

            init(isDismissalDisabled: Bool, onAttempt: @escaping () -> Void) {
                self.isDismissalDisabled = isDismissalDisabled
                self.onAttempt = onAttempt
                super.init(nibName: nil, bundle: nil)
            }

            required init?(coder: NSCoder) {
                fatalError("The dismissal observer requires an action.")
            }

            override func didMove(toParent parent: UIViewController?) {
                super.didMove(toParent: parent)
                observePresentation()
            }

            override func viewDidAppear(_ animated: Bool) {
                super.viewDidAppear(animated)
                observePresentation()
            }

            func observePresentation() {
                var ancestor = parent
                while let controller = ancestor {
                    if controller.presentingViewController != nil, let presentation = controller.presentationController
                    {
                        guard presentation.delegate !== self else { return }
                        stopObserving()
                        observedPresentation = presentation
                        previousDelegate = presentation.delegate
                        presentation.delegate = self
                        return
                    }
                    ancestor = controller.parent
                }
            }

            func stopObserving() {
                if let presentation = observedPresentation, presentation.delegate === self {
                    presentation.delegate = previousDelegate
                }
                observedPresentation = nil
                previousDelegate = nil
            }

            func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
                guard !isDismissalDisabled else { return false }
                return previousDelegate?.presentationControllerShouldDismiss?(presentationController) ?? true
            }

            func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
                onAttempt()
            }

            func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
                previousDelegate?.presentationControllerWillDismiss?(presentationController)
            }

            func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
                previousDelegate?.presentationControllerDidDismiss?(presentationController)
            }
        }
    }
#endif
