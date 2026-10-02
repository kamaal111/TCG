#if os(iOS)
    import Testing
    import UIKit

    @testable import TCGCards

    @Suite("TCGCard Form Dismissal Observer Tests")
    @MainActor
    struct TCGCardFormDismissalObserverTests {
        @Test
        func `Native dismissal attempts request confirmation and preserve the draft`() {
            let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
            model.values.name = "Draft"
            let observer = TCGCardFormDismissalObserver.ObserverController(isDismissalDisabled: true) {
                _ = model.requestDismissal()
            }
            let presentation = UIPresentationController(presentedViewController: observer, presenting: nil)

            #expect(!observer.presentationControllerShouldDismiss(presentation))
            observer.presentationControllerDidAttemptToDismiss(presentation)
            #expect(model.isShowingDiscardConfirmation)
            #expect(model.values.name == "Draft")
            model.keepEditing()
            #expect(!model.isShowingDiscardConfirmation)
            #expect(!observer.presentationControllerShouldDismiss(presentation))
        }

        @Test
        func `An unchanged form permits native dismissal`() {
            let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
            let observer = TCGCardFormDismissalObserver.ObserverController(
                isDismissalDisabled: model.hasUnsavedChanges
            ) {
                _ = model.requestDismissal()
            }
            let presentation = UIPresentationController(presentedViewController: observer, presenting: nil)

            #expect(observer.presentationControllerShouldDismiss(presentation))
            #expect(!model.isShowingDiscardConfirmation)
        }
    }
#endif
