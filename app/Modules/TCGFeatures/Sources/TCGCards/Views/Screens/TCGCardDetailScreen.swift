import SwiftUI
import TCGCardDetails
import TCGClient
import TCGDesignSystem

struct TCGCardDetailScreen: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss
    @State private var model: TCGCardDetailScreenModel

    init(model: TCGCardDetailScreenModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: requestDismissal) {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel(Text("Close", bundle: .module))
                .keyboardShortcut(.cancelAction)
                Spacer()
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                Button(action: editOrSave) {
                    if model.editor != nil {
                        Text("Save", bundle: .module)
                    } else {
                        Text("Edit", bundle: .module)
                    }
                }
            }
            .padding()
            Divider()
            if let editor = model.editor {
                editorContent(editor)
            } else {
                CardDetailContent(metadata: .init(ownedCard: model.card), price: model.card.price.price) {
                    collectionDetails
                }
            }
        }
        .background(.background)
        .disabled(model.editor?.isSubmitting == true)
        .interactiveDismissDisabled(model.editor?.hasUnsavedChanges == true || model.editor?.isSubmitting == true)
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #else
            .background {
                TCGCardFormDismissalObserver(
                    isDismissalDisabled: model.editor?.hasUnsavedChanges == true || model.editor?.isSubmitting == true,
                    onAttempt: requestDismissal
                )
                .frame(width: 0, height: 0)
            }
        #endif
    }

    private func editorContent(_ editor: TCGCardFormScreenModel) -> some View {
        @Bindable var editor = editor
        return ScrollView {
            TCGCardFormFields(model: editor, submitTitle: String(localized: "Save", bundle: .module)) {
                Task { await model.save(using: cards) }
            }
        }
        .confirmationDialog(
            Text("Discard changes?", bundle: .module),
            isPresented: $editor.isShowingDiscardConfirmation,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                dismiss()
            } label: {
                Text("Discard Changes", bundle: .module)
            }
            Button(role: .cancel) {
                editor.keepEditing()
            } label: {
                Text("Keep Editing", bundle: .module)
            }
        }
    }

    private var collectionDetails: some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent {
                Text(model.card.card.setName)
            } label: {
                Text("Set name", bundle: .module)
            }
            Text("Quantities", bundle: .module).font(.headline)
            ForEach(CardCondition.allCases, id: \.self) { condition in
                if let quantity = model.card.card.quantities.first(where: { $0.condition == condition }),
                    quantity.quantity > 0
                {
                    LabeledContent(condition.title, value: quantity.quantity.formatted())
                }
            }
            if let notes = model.card.card.notes, !notes.isEmpty {
                Text("Notes", bundle: .module).font(.headline)
                Text(notes)
            }
            if model.card.price.price == nil {
                Text("Pricing", bundle: .module).font(.title2.bold())
                CardPriceView(price: model.card.price)
            }
        }
    }

    private func editOrSave() {
        if model.editor == nil {
            model.edit()
        } else {
            Task { await model.save(using: cards) }
        }
    }

    private func requestDismissal() {
        if model.editor?.requestDismissal() ?? true { dismiss() }
    }
}
