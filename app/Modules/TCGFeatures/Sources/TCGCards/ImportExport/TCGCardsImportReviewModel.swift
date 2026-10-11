import Foundation
import Observation
import TCGClient

struct CardsImportCompletion: Equatable {
    let result: ImportCardsResult
    let needsRefresh: Bool
}

@MainActor
@Observable
final class TCGCardsImportReviewModel {
    var cards: [CSVImportCard] = []
    var filename: String
    var fatalError: String?
    var submissionError: String?
    private(set) var serverIssues: [CSVImportIssue] = []
    private var unmappedServerErrors: [String] = []
    var completion: CardsImportCompletion?
    var isSubmitting = false
    var hasEdits = false
    private var nextRowID = 1
    private(set) var removedRowCount = 0
    private(set) var removedCardCount = 0

    init(url: URL) {
        filename = url.lastPathComponent
        switch CardsCSV.read(from: url) {
        case .success(let importedCards):
            cards = importedCards
            nextRowID = (cards.flatMap(\.rows).map(\.id).max() ?? 1) + 1
        case .failure(let error): fatalError = error.localizedDescription
        }
    }

    init(filename: String, cards: [CSVImportCard]) {
        self.filename = filename
        self.cards = cards
        nextRowID = (cards.flatMap(\.rows).map(\.id).max() ?? 1) + 1
    }

    var selectedCards: [Card] { cards.compactMap { CardsCSV.makeCard($0, now: Date()) } }

    var selectedPurchaseCount: Int { selectedCards.reduce(0) { $0 + $1.purchases.count } }

    var invalidRowCount: Int {
        cards.filter(\.isIncluded).reduce(0) { count, card in
            count + card.rows.filter { !CardsCSV.issues(for: $0).isEmpty || !$0.isIncluded }.count
        }
    }

    var excludedRowCount: Int { removedRowCount + cards.reduce(0) { $0 + $1.rows.filter { !$0.isIncluded }.count } }

    var canImport: Bool { fatalError == nil && !selectedCards.isEmpty && !isSubmitting && completion == nil }

    func removeCard(id: UUID) {
        clearServerIssues(rows: cards.first { $0.id == id }?.rows ?? [])
        removedRowCount += cards.first { $0.id == id }?.rows.count ?? 0
        cards.removeAll { $0.id == id }
        removedCardCount += 1
        hasEdits = true
    }

    func saveRow(_ row: CSVImportRow, cardID: UUID) {
        guard let cardIndex = cards.firstIndex(where: { $0.id == cardID }) else { return }
        guard let rowIndex = cards[cardIndex].rows.firstIndex(where: { $0.id == row.id }) else { return }
        clearServerIssues(rows: [row])
        var corrected = row
        corrected.isIncluded = row.isIncluded && CardsCSV.issues(for: row).isEmpty
        cards[cardIndex].rows[rowIndex] = corrected
        cards = CardsCSV.group(cards.flatMap(\.rows))
        hasEdits = true
    }

    func saveCard(_ values: CardFormValues, id: UUID) {
        guard let index = cards.firstIndex(where: { $0.id == id }) else { return }
        guard let original = CardsCSV.makeCard(cards[index], now: Date()) else { return }
        clearServerIssues(rows: cards[index].rows)
        let payload = values.payload
        let purchases = payload.purchases.map { purchase in
            let prior = original.purchases.first { $0.id == purchase.id }
            let date =
                prior?.purchasePrice == purchase.purchasePrice && prior?.currency == purchase.currency
                ? prior?.automaticPriceDate : nil
            return CardPurchase(
                id: purchase.id,
                condition: purchase.condition,
                quantity: purchase.quantity,
                purchasePrice: purchase.purchasePrice,
                currency: purchase.currency,
                automaticPriceDate: date
            )
        }
        let edited = Card(
            id: original.id,
            game: payload.game,
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            notes: payload.notes,
            createdAt: original.createdAt,
            updatedAt: original.updatedAt,
            purchases: purchases
        )
        let oldRows = cards[index].rows
        let includedRows = oldRows.filter(\.isIncluded)
        let newRows = purchases.enumerated().map { offset, purchase in
            let line: Int
            if offset < includedRows.count {
                line = includedRows[offset].id
            } else {
                line = nextRowID
                nextRowID += 1
            }
            return CardsCSV.row(card: edited, purchase: purchase, line: line)
        }
        cards[index].rows = newRows + oldRows.filter { !$0.isIncluded }
        hasEdits = true
    }

    func submit(using collection: TCGCards) async {
        guard canImport else { return }
        isSubmitting = true
        submissionError = nil
        serverIssues = []
        unmappedServerErrors = []
        let submitted = cards.filter { CardsCSV.makeCard($0, now: Date()) != nil }
        defer { isSubmitting = false }
        switch await collection.importCards(cards) {
        case .success(let result): completion = result
        case .failure(.unauthorized):
            submissionError = String(
                localized: "Your session expired. Sign in again, then retry. Your import edits are still here.",
                bundle: .module
            )
        case .failure(.badRequest(let issues)):
            guard !issues.isEmpty else {
                submissionError = String(
                    localized:
                        "We couldn’t accept this import. Your edits are still here. Review your CSV, or contact support if this keeps happening.",
                    bundle: .module
                )
                return
            }

            for issue in issues {
                let mapped = CSVImportValidationFeedback.rows(for: issue, submitted: submitted)
                if mapped.isEmpty {
                    unmappedServerErrors.append("\(issue.path.joined(separator: ".")): \(issue.message)")
                } else {
                    serverIssues.append(contentsOf: mapped)
                }
            }
            updateValidationSummary()
        case .failure(.requestFailed):
            submissionError = String(
                localized:
                    "We couldn’t get a response while importing your cards. Your edits are still here. Try again. Retrying won’t create duplicate cards.",
                bundle: .module
            )
        case .failure(.invalidResponse):
            submissionError = String(
                localized:
                    "We couldn’t read the import confirmation. Your edits are still here. You can retry safely without creating duplicate cards. Contact support if this keeps happening.",
                bundle: .module
            )
        case .failure(.unknown):
            submissionError = String(
                localized:
                    "We couldn’t complete your import. Your edits are still here. Try again in a moment, or contact support if this keeps happening.",
                bundle: .module
            )
        }
    }

    private func clearServerIssues(rows: [CSVImportRow]) {
        let rowIDs = Set(rows.map(\.id))
        serverIssues.removeAll { rowIDs.contains($0.row) }
        unmappedServerErrors = []
        updateValidationSummary()
    }

    private func updateValidationSummary() {
        let details =
            serverIssues.map { issue in
                String(localized: "Row \(issue.row), \(issue.column.rawValue): \(issue.explanation)", bundle: .module)
            } + unmappedServerErrors
        guard !details.isEmpty else {
            submissionError = nil
            return
        }

        submissionError = String(
            localized:
                "We couldn’t import these cards. Correct the highlighted rows before retrying.\n\(details.joined(separator: "\n"))",
            bundle: .module
        )
    }
}
