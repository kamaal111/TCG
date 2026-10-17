import Foundation
import TCGClient
import TCGUtils
import TabularData

struct CSVImportIssue: Identifiable, Equatable {
    let row: Int
    let column: CardsCSV.Column
    let value: String
    let explanation: String

    var id: String { "\(row)-\(column.rawValue)-\(explanation)" }
}

struct CSVImportRow: Identifiable, Equatable {
    let id: Int
    let generatedPurchaseID = UUID()
    var cells: [CardsCSV.Column: String]
    var isIncluded = true

    subscript(_ column: CardsCSV.Column) -> String {
        get { cells[column] ?? "" }
        set { cells[column] = newValue }
    }
}

struct CSVImportCard: Identifiable, Equatable {
    let id: UUID
    var rows: [CSVImportRow]
    var isIncluded = true

    var name: String { rows.first?[.name] ?? "" }
}

enum CardsCSVError: LocalizedError, Equatable {
    case missingColumns([String])
    case duplicateColumns
    case brokenQuoting(Int)
    case columnCount(row: Int, actual: Int, expected: Int)
    case unreadable
    case unwritable

    var errorDescription: String? {
        switch self {
        case .missingColumns(let columns):
            String(
                localized:
                    "Missing columns: \(columns.joined(separator: ", ")). Download the CSV template and copy your data into its columns.",
                bundle: .module
            )
        case .duplicateColumns:
            String(
                localized:
                    "Some column names appear more than once. Keep one of each column, using the CSV template as a guide.",
                bundle: .module
            )
        case .brokenQuoting(let row):
            String(
                localized:
                    "The CSV structure breaks at row \(row). Close quoted fields and double any quotes inside them, or save the file again as CSV from your spreadsheet app.",
                bundle: .module
            )
        case .columnCount(let row, let actual, let expected):
            String(
                localized:
                    "Row \(row) has \(actual) columns; the header has \(expected). Check for missing cells or extra commas. Put text containing commas inside double quotes.",
                bundle: .module
            )
        case .unwritable:
            String(localized: "The CSV file could not be saved. Try exporting again.", bundle: .module)
        case .unreadable:
            String(
                localized:
                    "This file could not be read as UTF-8 text. Save it as a UTF-8 CSV and choose the file again.",
                bundle: .module
            )
        }
    }
}

enum CardsCSV {
    enum Column: String, CaseIterable {
        case id, game, name, notes, condition, quantity, currency
        case setName = "set_name"
        case cardNumber = "card_number"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case purchaseID = "purchase_id"
        case purchasePrice = "purchase_price"
        case automaticPriceDate = "automatic_price_date"
    }

    static let columns: [Column] = [
        .id, .game, .name, .setName, .cardNumber, .notes, .createdAt, .updatedAt,
        .purchaseID, .condition, .quantity, .purchasePrice, .currency, .automaticPriceDate,
    ]
    private static let metadata: [Column] = [.id, .game, .name, .setName, .cardNumber, .notes, .createdAt, .updatedAt]

    static func read(from url: URL) -> Result<[CSVImportCard], CardsCSVError> {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let contents: String
        do { contents = try String(contentsOf: url, encoding: .utf8) } catch { return .failure(.unreadable) }
        return parse(contents)
    }

    static func parse(_ contents: String) -> Result<[CSVImportCard], CardsCSVError> {
        let text = contents.hasPrefix("\u{FEFF}") ? String(contents.dropFirst()) : contents
        let records: [Record]
        switch scan(text) {
        case .success(let scanned): records = scanned
        case .failure(let error): return .failure(error)
        }
        guard let header = records.first else { return .failure(.missingColumns(columns.map(\.rawValue))) }
        let names = header.fields.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\u{FEFF}", with: "")
        }
        guard Set(names).count == names.count else { return .failure(.duplicateColumns) }
        let missing = columns.filter { !names.contains($0.rawValue) }
        guard missing.isEmpty else { return .failure(.missingColumns(missing.map(\.rawValue))) }
        var rows: [CSVImportRow] = []
        for record in records.dropFirst() {
            guard record.fields.count == names.count else {
                return .failure(.columnCount(row: record.line, actual: record.fields.count, expected: names.count))
            }
            var cells: [Column: String] = [:]
            for (index, name) in names.enumerated() {
                if let column = Column(rawValue: name) { cells[column] = record.fields[index] }
            }
            var row = CSVImportRow(id: record.line, cells: cells)
            row.isIncluded = issues(for: row).isEmpty
            rows.append(row)
        }
        return .success(group(rows))
    }

    static func group(_ rows: [CSVImportRow]) -> [CSVImportCard] {
        var cards: [CSVImportCard] = []
        var positions: [String: Int] = [:]
        for row in rows {
            let sourceID = trimmed(row[.id]).lowercased()
            let key = sourceID.isEmpty ? "row-\(row.id)" : sourceID
            if let position = positions[key] {
                cards[position].rows.append(row)
            } else {
                positions[key] = cards.count
                cards.append(.init(id: UUID(), rows: [row]))
            }
        }
        for index in cards.indices {
            let invalidRows = Set(issues(for: cards[index]).map(\.row))
            for rowIndex in cards[index].rows.indices where invalidRows.contains(cards[index].rows[rowIndex].id) {
                cards[index].rows[rowIndex].isIncluded = false
            }
        }
        return cards
    }

    static func export(_ cards: [Card]) -> Result<URL, CardsCSVError> {
        let rows = cards.flatMap { card in card.purchases.map { row(card: card, purchase: $0) } }
        let frame = DataFrame(
            columns: columns.map { column in
                TabularData.Column<String>(name: column.rawValue, contents: rows.map { $0[column] }).eraseToAnyColumn()
            }
        )
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tcg-cards-\(UUID().uuidString).csv")
        do {
            try frame.writeCSV(to: url, options: CSVWritingOptions(includesHeader: true, newline: "\n", delimiter: ","))
            return .success(url)
        } catch {
            return .failure(.unwritable)
        }
    }

    static func row(card: Card, purchase: CardPurchase, line: Int = 0) -> CSVImportRow {
        CSVImportRow(
            id: line,
            cells: [
                .id: card.id, .game: card.game.rawValue, .name: card.name, .setName: card.setName,
                .cardNumber: card.cardNumber, .notes: card.notes ?? "", .createdAt: dateString(card.createdAt),
                .updatedAt: dateString(card.updatedAt), .purchaseID: purchase.id ?? UUID().uuidString.lowercased(),
                .condition: purchase.condition.rawValue, .quantity: String(purchase.quantity),
                .purchasePrice: purchase.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue } ?? "",
                .currency: purchase.currency?.rawValue ?? "", .automaticPriceDate: purchase.automaticPriceDate ?? "",
            ]
        )
    }

    static func issues(for row: CSVImportRow) -> [CSVImportIssue] {
        var issues: [CSVImportIssue] = []
        func issue(_ column: Column, _ explanation: String) {
            issues.append(.init(row: row.id, column: column, value: row[column], explanation: explanation))
        }
        if UUID(uuidString: trimmed(row[.id])) == nil {
            issue(
                .id,
                String(
                    localized:
                        "Enter a UUID card ID, such as 550e8400-e29b-41d4-a716-446655440000. Use the same ID for every purchase of this card.",
                    bundle: .module
                )
            )
        }
        if ClientCardGame(rawValue: trimmed(row[.game])) == nil {
            issue(.game, String(localized: "Enter one_piece or pokemon.", bundle: .module))
        }
        for (column, maximum) in [(Column.name, 200), (.setName, 200), (.cardNumber, 50)] {
            if trimmed(row[column]).isEmpty || row[column].count > maximum {
                issue(column, String(localized: "Enter a value between 1 and \(maximum) characters.", bundle: .module))
            }
        }
        if row[.notes].count > 2000 {
            issue(.notes, String(localized: "Shorten the notes to 2000 characters or fewer.", bundle: .module))
        }
        if CardCondition(rawValue: trimmed(row[.condition])) == nil {
            issue(
                .condition,
                String(localized: "Enter mint, near_mint, excellent, good, played, or damaged.", bundle: .module)
            )
        }
        if let quantity = Int(trimmed(row[.quantity])), (1...999).contains(quantity) {
        } else {
            issue(.quantity, String(localized: "Enter a whole number from 1 to 999.", bundle: .module))
        }
        let price = trimmed(row[.purchasePrice])
        let currency = trimmed(row[.currency])
        if !price.isEmpty
            && price.range(of: #"^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$"#, options: .regularExpression) == nil
        {
            issue(
                .purchasePrice,
                String(
                    localized:
                        "Enter a nonnegative price using a decimal point and at most six decimal places, such as 2.50.",
                    bundle: .module
                )
            )
        }
        if price.isEmpty != currency.isEmpty {
            issue(
                .purchasePrice,
                String(localized: "Provide both purchase_price and currency, or leave both blank.", bundle: .module)
            )
        }
        if !currency.isEmpty && Currency(rawValue: currency) == nil {
            issue(
                .currency,
                String(
                    localized:
                        "Enter a supported currency code, such as EUR, USD or JPY, or leave it blank when the price is blank.",
                    bundle: .module
                )
            )
        }
        for column in [Column.createdAt, .updatedAt] where !trimmed(row[column]).isEmpty && date(row[column]) == nil {
            issue(
                column,
                String(
                    localized: "Enter an ISO 8601 timestamp, such as 2026-07-20T10:30:00Z, or leave it blank.",
                    bundle: .module
                )
            )
        }
        if !trimmed(row[.purchaseID]).isEmpty && UUID(uuidString: trimmed(row[.purchaseID])) == nil {
            issue(
                .purchaseID,
                String(localized: "Enter a UUID purchase ID, or leave it blank to generate one.", bundle: .module)
            )
        }
        let automaticDate = trimmed(row[.automaticPriceDate])
        if !automaticDate.isEmpty {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = .gmt
            formatter.dateFormat = "yyyy-MM-dd"
            if let value = formatter.date(from: automaticDate), formatter.string(from: value) == automaticDate,
                !price.isEmpty
            {
            } else {
                issue(
                    .automaticPriceDate,
                    String(
                        localized: "Enter a real date as YYYY-MM-DD with a purchase price, or leave this field blank.",
                        bundle: .module
                    )
                )
            }
        }
        return issues
    }

    static func issues(for card: CSVImportCard) -> [CSVImportIssue] {
        var result = card.rows.flatMap { issues(for: $0) }
        var reference: CSVImportRow?
        var quantities: [String: Int] = [:]
        var purchases = Set<String>()
        for row in card.rows where row.isIncluded && issues(for: row).isEmpty {
            if let reference {
                for column in metadata
                where normalized(row[column], column: column) != normalized(reference[column], column: column) {
                    result.append(
                        .init(
                            row: row.id,
                            column: column,
                            value: row[column],
                            explanation:
                                String(
                                    localized:
                                        "This differs from another purchase of the same card. Make the card fields match, or give it a different card ID.",
                                    bundle: .module
                                )
                        )
                    )
                }
            } else {
                reference = row
            }
            let purchaseID = trimmed(row[.purchaseID]).lowercased()
            if !purchaseID.isEmpty && !purchases.insert(purchaseID).inserted {
                result.append(
                    .init(
                        row: row.id,
                        column: .purchaseID,
                        value: purchaseID,
                        explanation:
                            String(
                                localized:
                                    "This purchase ID is repeated. Remove the duplicate row or use a different purchase ID.",
                                bundle: .module
                            )
                    )
                )
            }
            quantities[row[.condition], default: 0] += Int(trimmed(row[.quantity])) ?? 0
            if quantities[row[.condition], default: 0] > 999 {
                result.append(
                    .init(
                        row: row.id,
                        column: .quantity,
                        value: row[.quantity],
                        explanation:
                            String(
                                localized:
                                    "These purchases exceed 999 copies in one condition. Reduce the quantities or exclude this purchase.",
                                bundle: .module
                            )
                    )
                )
            }
        }
        return result
    }

    static func makeCard(_ draft: CSVImportCard, now: Date) -> Card? {
        guard draft.isIncluded else { return nil }
        let included = draft.rows.filter(\.isIncluded)
        guard let first = included.first else { return nil }
        let selected = CSVImportCard(id: draft.id, rows: included)
        guard issues(for: selected).isEmpty else { return nil }
        guard let game = ClientCardGame(rawValue: trimmed(first[.game])) else { return nil }
        let purchases = included.compactMap { row -> CardPurchase? in
            guard let condition = CardCondition(rawValue: trimmed(row[.condition])) else { return nil }
            guard let quantity = Int(trimmed(row[.quantity])) else { return nil }
            let price = trimmed(row[.purchasePrice])
            return .init(
                id: trimmed(row[.purchaseID]).isEmpty
                    ? row.generatedPurchaseID.uuidString.lowercased() : trimmed(row[.purchaseID]).lowercased(),
                condition: condition,
                quantity: quantity,
                purchasePrice: price.isEmpty ? nil : Decimal(string: price, locale: TCGLocales.decimal),
                currency: Currency(rawValue: trimmed(row[.currency])),
                automaticPriceDate: trimmed(row[.automaticPriceDate]).isEmpty ? nil : trimmed(row[.automaticPriceDate])
            )
        }
        return Card(
            id: trimmed(first[.id]).lowercased(),
            game: game,
            name: trimmed(first[.name]),
            setName: trimmed(first[.setName]),
            cardNumber: trimmed(first[.cardNumber]),
            notes: first[.notes].isEmpty ? nil : first[.notes],
            createdAt: date(first[.createdAt]) ?? now,
            updatedAt: date(first[.updatedAt]) ?? now,
            purchases: purchases
        )
    }

    private static func normalized(_ value: String, column: Column) -> String {
        switch column {
        case .id: trimmed(value).lowercased()
        case .notes: value
        case .createdAt, .updatedAt: date(value).map(dateString) ?? trimmed(value)
        default: trimmed(value)
        }
    }

    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func dateString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: trimmed(value)) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: trimmed(value))
    }

    private struct Record {
        let line: Int
        let fields: [String]
    }

    private enum ScanState { case start, unquoted, quoted, closed }

    private static func scan(_ contents: String) -> Result<[Record], CardsCSVError> {
        var result: [Record] = []
        var fields: [String] = []
        var field = ""
        var state = ScanState.start
        var line = 1
        var startLine = 1
        for character in contents {
            switch state {
            case .quoted:
                if character == "\"" {
                    state = .closed
                } else {
                    field.append(character)
                    if character.isNewline { line += 1 }
                }
            case .closed:
                if character == "\"" {
                    field.append(character)
                    state = .quoted
                } else if character == "," {
                    fields.append(field)
                    field = ""
                    state = .start
                } else if character.isNewline {
                    fields.append(field)
                    result.append(.init(line: startLine, fields: fields))
                    fields = []
                    field = ""
                    state = .start
                    line += 1
                    startLine = line
                } else {
                    return .failure(.brokenQuoting(startLine))
                }
            case .start, .unquoted:
                if character == "\"" {
                    guard state == .start else { return .failure(.brokenQuoting(startLine)) }
                    state = .quoted
                } else if character == "," {
                    fields.append(field)
                    field = ""
                    state = .start
                } else if character.isNewline {
                    if !fields.isEmpty || !field.trimmingCharacters(in: .whitespaces).isEmpty {
                        fields.append(field)
                        result.append(.init(line: startLine, fields: fields))
                    }
                    fields = []
                    field = ""
                    state = .start
                    line += 1
                    startLine = line
                } else {
                    field.append(character)
                    state = .unquoted
                }
            }
        }
        guard state != .quoted else { return .failure(.brokenQuoting(startLine)) }
        if !fields.isEmpty || !field.trimmingCharacters(in: .whitespaces).isEmpty {
            fields.append(field)
            result.append(.init(line: startLine, fields: fields))
        }
        return .success(result)
    }
}
