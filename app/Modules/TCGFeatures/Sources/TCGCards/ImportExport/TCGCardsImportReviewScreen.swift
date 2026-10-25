import SwiftUI
import TCGUtils
import UniformTypeIdentifiers

public struct TCGCardsImportReviewScreen: View {
    @Environment(TCGCards.self) private var collection
    @Environment(\.dismiss) private var dismiss

    @State private var model: TCGCardsImportReviewModel
    @State private var rowEditor: RowEditorSelection?
    @State private var cardEditor: CSVImportCard?
    @State private var isChoosingFile = false
    @State private var isConfirmingFileChange = false
    @State private var isConfirmingDiscard = false
    @State private var document: CSVFileDocument?
    @State private var isExportingTemplate = false

    public init(url: URL) {
        _model = State(initialValue: TCGCardsImportReviewModel(url: url))
    }

    init(model: TCGCardsImportReviewModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(model.filename).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                    if let completion = model.completion {
                        CSVImportCompletionView(completion: completion, model: model) { dismiss() }
                    } else {
                        CSVImportReviewContent(
                            model: model,
                            actions: .init(
                                editCard: { cardEditor = $0 },
                                editRow: { row, cardID in rowEditor = .init(cardID: cardID, row: row) },
                                downloadTemplate: downloadTemplate,
                                chooseAnotherFile: chooseAnotherFile
                            )
                        )
                    }
                }
                .padding(24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle(Text("Review Import", bundle: .module))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        if model.hasEdits && model.completion == nil { isConfirmingDiscard = true } else { dismiss() }
                    } label: {
                        Text("Close", bundle: .module)
                    }
                    .disabled(model.isSubmitting)
                }
            }
        }
        .frame(minWidth: 0)
        #if os(macOS)
            .frame(width: 650, height: 650)
        #endif
        .interactiveDismissDisabled(model.hasEdits || model.isSubmitting)
        .sheet(item: $rowEditor) { selection in
            CSVRowEditor(row: selection.row) { row in model.saveRow(row, cardID: selection.cardID) }
        }
        .sheet(item: $cardEditor) { card in
            if let value = CardsCSV.makeCard(card, now: Date()) {
                CSVCardEditor(card: value) { values in model.saveCard(values, id: card.id) }
            }
        }
        .confirmationDialog(Text("Discard import edits?", bundle: .module), isPresented: $isConfirmingDiscard) {
            Button(role: .destructive) {
                dismiss()
            } label: {
                Text("Discard Edits", bundle: .module)
            }
        }
        .confirmationDialog(
            Text("Choose another file and discard these edits?", bundle: .module),
            isPresented: $isConfirmingFileChange
        ) {
            Button(role: .destructive) {
                isChoosingFile = true
            } label: {
                Text("Choose Another File", bundle: .module)
            }
        }
        .fileImporter(isPresented: $isChoosingFile, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            switch result {
            case .success(let url): model = TCGCardsImportReviewModel(url: url)
            case .failure(let error): model.submissionError = error.localizedDescription
            }
        }
        .fileExporter(
            isPresented: $isExportingTemplate,
            document: document,
            contentType: .commaSeparatedText,
            defaultFilename: "tcg-cards-template"
        ) { result in
            document = nil
            if case .failure(let error) = result { model.submissionError = error.localizedDescription }
        }
    }

    private func chooseAnotherFile() {
        if model.hasEdits { isConfirmingFileChange = true } else { isChoosingFile = true }
    }

    private func downloadTemplate() {
        do {
            switch collection.downloadCardsTemplate() {
            case .success(let url):
                document = try CSVFileDocument(temporaryURL: url)
                isExportingTemplate = true
            case .failure(let error): model.submissionError = error.localizedDescription
            }
        } catch { model.submissionError = error.localizedDescription }
    }

    private struct RowEditorSelection: Identifiable {
        let cardID: UUID
        let row: CSVImportRow
        var id: Int { row.id }
    }
}
