import TCGClient

enum CSVImportValidationFeedback {
    private enum CollectionField: String {
        case cards
        case purchases
    }

    static func rows(for issue: TCGClientValidationIssue, submitted: [CSVImportCard]) -> [CSVImportIssue] {
        let path = issue.path
        guard path.first.flatMap(CollectionField.init(rawValue:)) == .cards else { return [] }
        guard path.count >= 3 else { return [] }
        guard let cardIndex = Int(path[1]) else { return [] }
        guard submitted.indices.contains(cardIndex) else { return [] }

        let rows = submitted[cardIndex].rows.filter(\.isIncluded)
        let affected: [CSVImportRow]
        let column: CardsCSV.Column
        if CollectionField(rawValue: path[2]) == .purchases {
            guard path.count == 5 else { return [] }
            guard let purchaseIndex = Int(path[3]) else { return [] }
            guard rows.indices.contains(purchaseIndex) else { return [] }
            guard let field = CardsCSV.Column(rawValue: path[4]) else { return [] }

            affected = [rows[purchaseIndex]]
            column = field == .id ? .purchaseID : field
        } else {
            guard path.count == 3 else { return [] }
            guard let field = CardsCSV.Column(rawValue: path[2]) else { return [] }

            affected = rows
            column = field
        }
        return affected.map { row in
            .init(row: row.id, column: column, value: row[column], explanation: issue.message)
        }
    }
}
