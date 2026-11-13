import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// Shares keyboard dismissal between inline text fields and navigation search fields.
public struct TCGSearchKeyboardScope<Content: View>: View {
    @FocusState private var defaultFocus: Bool
    #if os(iOS)
        @State private var inlineField = SearchFieldRegion()
    #endif

    private let externalFocus: FocusState<Bool>.Binding?
    private let search: (query: Binding<String>, prompt: Text)?
    private let content: (FocusState<Bool>.Binding) -> Content

    public init(
        focus: FocusState<Bool>.Binding? = nil,
        @ViewBuilder content: @escaping (FocusState<Bool>.Binding) -> Content
    ) {
        externalFocus = focus
        search = nil
        self.content = content
    }

    public init(query: Binding<String>, prompt: Text, @ViewBuilder content: @escaping () -> Content) {
        externalFocus = nil
        search = (query, prompt)
        self.content = { _ in content() }
    }

    public var body: some View {
        searchContent
            #if os(iOS)
                .environment(\.searchFieldRegion, inlineField)
                .background {
                    if focus.wrappedValue {
                        SearchOutsideTapObserver(inlineField: inlineField, usesSystemSearch: search != nil) {
                            focus.wrappedValue = false
                        }
                    }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        if focus.wrappedValue && search == nil {
                            Spacer()
                            Button {
                                focus.wrappedValue = false
                            } label: {
                                Image(systemName: "keyboard.chevron.compact.down")
                            }
                            .accessibilityLabel(Text("Dismiss keyboard", bundle: .module))
                        }
                    }
                }
            #endif
    }

    private var focus: FocusState<Bool>.Binding { externalFocus ?? $defaultFocus }

    @ViewBuilder
    private var searchContent: some View {
        if let search {
            content(focus)
                .searchable(text: search.query, prompt: search.prompt)
                #if os(iOS)
                    .searchFocused(focus)
                #endif
        } else {
            content(focus)
        }
    }
}

/// Marks the inline text field and its editing controls as part of the search field.
public struct TCGSearchEditingRegion<Content: View>: View {
    #if os(iOS)
        @Environment(\.searchFieldRegion) private var region
    #endif

    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            #if os(iOS)
                .background { SearchFieldRegionMarker(region: region) }
            #endif
    }
}

#if os(iOS)
    private final class SearchFieldRegion {
        weak var view: UIView?
    }

    extension EnvironmentValues {
        @Entry fileprivate var searchFieldRegion: SearchFieldRegion?
    }

    private struct SearchFieldRegionMarker: UIViewRepresentable {
        let region: SearchFieldRegion?

        func makeUIView(context: Context) -> UIView {
            let view = UIView()
            view.isUserInteractionEnabled = false
            return view
        }

        func updateUIView(_ view: UIView, context: Context) {
            region?.view = view
        }
    }

    private struct SearchOutsideTapObserver: UIViewRepresentable {
        let inlineField: SearchFieldRegion
        let usesSystemSearch: Bool
        let dismiss: () -> Void

        func makeUIView(context: Context) -> ObserverView {
            let view = ObserverView()
            view.isUserInteractionEnabled = false
            return view
        }

        func updateUIView(_ view: ObserverView, context: Context) {
            view.inlineField = inlineField
            view.dismiss = dismiss
            view.usesSystemSearch = usesSystemSearch
            view.observeWindow()
            view.attachSearchAccessory()
        }

        static func dismantleUIView(_ view: ObserverView, coordinator: Void) {
            view.stopObserving()
            view.dismiss = nil
        }

        final class ObserverView: UIView, UIGestureRecognizerDelegate {
            weak var inlineField: SearchFieldRegion?
            var dismiss: (() -> Void)?
            var usesSystemSearch = false

            private weak var observedWindow: UIWindow?
            private weak var searchField: UISearchTextField?
            private var previousAccessory: UIView?
            private lazy var searchAccessory = makeSearchAccessory()
            private lazy var tap = makeTapRecognizer()

            override func didMoveToWindow() {
                super.didMoveToWindow()
                observeWindow()
                attachSearchAccessory()
            }

            func observeWindow() {
                guard observedWindow !== window else { return }
                stopObserving()
                observedWindow = window
                window?.addGestureRecognizer(tap)
                if window != nil {
                    NotificationCenter.default.addObserver(
                        self,
                        selector: #selector(searchDidBeginEditing),
                        name: UITextField.textDidBeginEditingNotification,
                        object: nil
                    )
                }
            }

            func stopObserving() {
                observedWindow?.removeGestureRecognizer(tap)
                NotificationCenter.default.removeObserver(
                    self,
                    name: UITextField.textDidBeginEditingNotification,
                    object: nil
                )
                observedWindow = nil
                detachSearchAccessory()
            }

            func attachSearchAccessory() {
                guard usesSystemSearch, searchField == nil, let window else { return }
                guard let field = focusedSearchField(in: window) else { return }
                attachSearchAccessory(to: field)
            }

            @objc private func searchDidBeginEditing(_ notification: Notification) {
                guard usesSystemSearch, let field = notification.object as? UISearchTextField,
                    field.window === observedWindow
                else { return }
                attachSearchAccessory(to: field)
            }

            private func focusedSearchField(in view: UIView) -> UISearchTextField? {
                if let field = view as? UISearchTextField, field.isFirstResponder { return field }
                for subview in view.subviews {
                    if let field = focusedSearchField(in: subview) { return field }
                }
                return nil
            }

            private func attachSearchAccessory(to field: UISearchTextField) {
                guard searchField !== field else { return }
                detachSearchAccessory()
                searchField = field
                previousAccessory = field.inputAccessoryView
                field.inputAccessoryView = searchAccessory
                field.reloadInputViews()
            }

            private func detachSearchAccessory() {
                if let searchField, searchField.inputAccessoryView === searchAccessory {
                    searchField.inputAccessoryView = previousAccessory
                    searchField.reloadInputViews()
                }
                searchField = nil
                previousAccessory = nil
            }

            private func makeSearchAccessory() -> UIToolbar {
                let toolbar = UIToolbar()
                let button = UIBarButtonItem(
                    image: UIImage(systemName: "keyboard.chevron.compact.down"),
                    style: .plain,
                    target: self,
                    action: #selector(dismissKeyboard)
                )
                button.accessibilityLabel = String(localized: "Dismiss keyboard", bundle: .module)
                toolbar.items = [.flexibleSpace(), button]
                toolbar.sizeToFit()
                return toolbar
            }

            @objc private func dismissKeyboard() {
                dismiss?()
            }

            func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
                if let field = inlineField?.view, field.window === observedWindow,
                    field.bounds.contains(touch.location(in: field))
                {
                    return false
                }
                var ancestor = touch.view
                while let view = ancestor {
                    if view is UISearchBar || view is UISearchTextField { return false }
                    ancestor = view.superview
                }
                return true
            }

            func gestureRecognizer(
                _ gestureRecognizer: UIGestureRecognizer,
                shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
            ) -> Bool {
                true
            }

            private func makeTapRecognizer() -> UITapGestureRecognizer {
                let recognizer = UITapGestureRecognizer(target: self, action: #selector(didTapOutside))
                recognizer.cancelsTouchesInView = false
                recognizer.delaysTouchesBegan = false
                recognizer.delaysTouchesEnded = false
                recognizer.delegate = self
                return recognizer
            }

            @objc private func didTapOutside() {
                // Let controls handle the tap before focus changes the visible results or suggestions.
                Task { @MainActor [weak self] in self?.dismiss?() }
            }
        }
    }
#endif
