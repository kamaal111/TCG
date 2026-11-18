import Foundation
import TCGClient

struct CSVPrintingQuery: Hashable {
    let game: ClientCardGame
    let name: String
    let setName: String
    let cardNumber: String

    init(card: Card) {
        game = card.game
        name = Self.normalized(card.name)
        setName = Self.normalized(card.setName)
        cardNumber = Self.normalized(card.cardNumber)
    }

    func matches(_ card: PricedCard) -> Bool {
        game == card.game && name == Self.normalized(card.name) && setName == Self.normalized(card.setName ?? "")
            && cardNumber == Self.normalized(card.cardNumber) && UUID(uuidString: card.id) != nil
    }

    private static func normalized(_ value: String) -> String {
        value.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
    }
}

enum CSVPrintingLookup {
    case loading
    case failed
    case noMatch
    case matches([PricedCard])

    static func resolve(_ query: CSVPrintingQuery, using collection: TCGCards) async -> Self {
        var cursor: String?
        var visitedCursors: Set<String> = []
        var printingKeys: Set<String> = []
        var matches: [PricedCard] = []
        repeat {
            guard !Task.isCancelled else { return .failed }
            let result = await collection.catalogSearch(
                game: query.game,
                name: query.name,
                cardNumber: query.cardNumber,
                cursor: cursor
            )
            guard case .success(let page) = result else { return .failed }
            for card in page.matches where query.matches(card) {
                if printingKeys.insert(card.printingKey ?? card.id).inserted { matches.append(card) }
            }
            cursor = page.nextCursor
            if let cursor, !visitedCursors.insert(cursor).inserted { return .failed }
        } while cursor != nil

        return matches.isEmpty ? .noMatch : .matches(matches)
    }
}
