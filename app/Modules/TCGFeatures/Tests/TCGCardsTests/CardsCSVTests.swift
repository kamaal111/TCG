import Foundation
import TCGClient
import Testing

@testable import TCGCards

@Suite("Card CSV Tests")
struct CardsCSVTests {
    @Test
    func `Export round trips separate purchases and quoted notes`() throws {
        let source = CardsCSVFixtures.card
        let url = try CardsCSV.export([source]).get()
        defer { try? FileManager.default.removeItem(at: url) }
        let drafts = try CardsCSV.read(from: url).get()
        let draft = try #require(drafts.first)
        let restored = try #require(CardsCSV.makeCard(draft, now: CardsCSVFixtures.date))
        #expect(drafts.count == 1)
        #expect(restored == source)
        #expect(draft.rows.count == 2)
    }

    @Test
    func `Empty export is a downloadable headers only template`() throws {
        let url = try CardsCSV.export([]).get()
        defer { try? FileManager.default.removeItem(at: url) }
        let contents = try String(contentsOf: url, encoding: .utf8)
        #expect(contents.trimmingCharacters(in: .newlines) == CardsCSV.columns.map(\.rawValue).joined(separator: ","))
        #expect(try CardsCSV.parse(contents).get().isEmpty)
    }

    @Test
    func `Missing headers explain which columns to add`() {
        #expect(
            CardsCSV.parse("id,name\n123,Luffy\n")
                == .failure(
                    .missingColumns(CardsCSV.columns.filter { $0 != .id && $0 != .name }.map(\.rawValue))
                )
        )
        #expect(
            CardsCSVError.missingColumns(["condition", "quantity"]).localizedDescription.contains("condition, quantity")
        )
    }

    @Test
    func `Duplicate column names and unterminated quotes are rejected`() {
        #expect(CardsCSV.parse("id,id\n") == .failure(.duplicateColumns))
        #expect(CardsCSV.parse("id,name\n123,\"Luffy\n") == .failure(.brokenQuoting(2)))
    }

    @Test
    func `Wrong row width returns its line and expected column count`() {
        let header = CardsCSV.columns.map(\.rawValue).joined(separator: ",")
        #expect(CardsCSV.parse("\(header)\n123,Luffy\n") == .failure(.columnCount(row: 2, actual: 2, expected: 14)))
    }

    @Test
    func `An inaccessible file returns an unreadable failure`() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        #expect(CardsCSV.read(from: url) == .failure(.unreadable))
    }

    @Test
    func `Quoted headers with UTF8 BOM and CRLF empty lines are accepted`() throws {
        let header = CardsCSV.columns.map { "\"\($0.rawValue)\"" }.joined(separator: ",")
        let contents = "\u{FEFF}\(header)\r\n\r\n"
        #expect(try CardsCSV.parse(contents).get().isEmpty)
    }

    @Test
    func `Malformed purchase is retained with actionable field feedback`() throws {
        var row = CardsCSVFixtures.rows[0]
        row[.quantity] = "two"
        let issue = try #require(CardsCSV.issues(for: row).first)
        #expect(issue.row == 2)
        #expect(issue.column == .quantity)
        #expect(issue.value == "two")
        #expect(issue.explanation.contains("1 to 999"))
    }

    @Test(arguments: ["-1", "1.5", "1000", "", "two"])
    func `Invalid quantities are excluded`(quantity: String) {
        var row = CardsCSVFixtures.rows[0]
        row[.quantity] = quantity
        #expect(CardsCSV.issues(for: row).contains { $0.column == .quantity })
    }

    @Test(arguments: ["-0.01", "1.1234567", "1,50", "NaN", "Infinity"])
    func `Invalid exact decimal amounts explain the accepted format`(price: String) {
        var row = CardsCSVFixtures.rows[0]
        row[.purchasePrice] = price
        #expect(CardsCSV.issues(for: row).contains { $0.column == .purchasePrice })
    }

    @Test
    func `Zero price and a six decimal amount are valid`() {
        var row = CardsCSVFixtures.rows[0]
        row[.purchasePrice] = "0"
        #expect(CardsCSV.issues(for: row).isEmpty)
        row[.purchasePrice] = "3.123456"
        #expect(CardsCSV.issues(for: row).isEmpty)
    }

    @Test
    func `Price requires a paired currency`() {
        var row = CardsCSVFixtures.rows[0]
        row[.currency] = ""
        #expect(CardsCSV.issues(for: row).contains { $0.column == .purchasePrice })
        row[.purchasePrice] = ""
        row[.automaticPriceDate] = ""
        #expect(CardsCSV.issues(for: row).isEmpty)
    }

    @Test
    func `Duplicate purchases conflicting card fields and condition overflow are explained`() {
        var duplicate = CardsCSVFixtures.rows[0]
        duplicate = .init(id: 4, cells: duplicate.cells)
        duplicate[.name] = "Different name"
        duplicate[.quantity] = "999"
        let card = CSVImportCard(id: UUID(), rows: [CardsCSVFixtures.rows[0], duplicate])
        let issues = CardsCSV.issues(for: card)
        #expect(issues.contains { $0.column == .purchaseID && $0.row == 4 })
        #expect(issues.contains { $0.column == .name && $0.row == 4 })
        #expect(issues.contains { $0.column == .quantity && $0.row == 4 })
    }

    @Test
    func `Changing a row card ID creates a separate reviewed card`() {
        let original = CardsCSVFixtures.draft
        var rows = original.rows
        rows[1][.id] = "550e8400-e29b-41d4-a716-446655440010"
        let grouped = CardsCSV.group(rows)
        #expect(grouped.count == 2)
        #expect(grouped.map { $0.rows.count } == [1, 1])
    }

    @Test
    func `Blank purchase IDs remain stable throughout review`() throws {
        var row = CardsCSVFixtures.rows[0]
        row[.purchaseID] = ""
        let draft = CSVImportCard(id: UUID(), rows: [row])
        let first = try #require(CardsCSV.makeCard(draft, now: CardsCSVFixtures.date))
        let second = try #require(CardsCSV.makeCard(draft, now: CardsCSVFixtures.date))
        #expect(first.purchases.first?.id == second.purchases.first?.id)
        #expect(first.purchases.first?.id != nil)
    }

    @Test
    func `Automatic pricing provenance needs a real date and price`() {
        var row = CardsCSVFixtures.rows[0]
        row[.automaticPriceDate] = "2026-02-30"
        #expect(CardsCSV.issues(for: row).contains { $0.column == .automaticPriceDate })
        row[.automaticPriceDate] = "2026-07-20"
        row[.purchasePrice] = ""
        row[.currency] = ""
        #expect(CardsCSV.issues(for: row).contains { $0.column == .automaticPriceDate })
    }

    @Test
    func `Blank purchase IDs and timestamps are generated at import`() throws {
        var row = CardsCSVFixtures.rows[0]
        row[.purchaseID] = ""
        row[.createdAt] = ""
        row[.updatedAt] = ""
        let card = try #require(CardsCSV.makeCard(.init(id: UUID(), rows: [row]), now: CardsCSVFixtures.date))
        let payload = ImportCardPayload(card: card)
        #expect(card.createdAt == CardsCSVFixtures.date)
        #expect(try #require(payload.purchases.first).id == #require(card.purchases.first?.id))
    }
}

enum CardsCSVFixtures {
    static let reportedCSV = """
        id,game,name,set_name,card_number,notes,created_at,updated_at,purchase_id,condition,quantity,purchase_price,currency,automatic_price_date
        9ecb8b92-e1ad-4863-bd0e-7ca38210835b,pokemon,イブキのカイリュー,ポケモンカード★VS,049/141,,2026-10-13T19:32:58.959Z,2026-10-13T19:32:59.788Z,fd9bb814-18c4-464b-a7b2-bb303c19933d,excellent,1,180,USD,
        """

    static let date = Date(timeIntervalSince1970: 1_784_543_400)
    static let card = Card(
        id: UUID(uuid: (85, 14, 132, 0, 226, 155, 65, 212, 167, 22, 68, 102, 85, 68, 0, 0)),
        game: .onePiece,
        name: "Monkey D. Luffy",
        setName: "Romance Dawn",
        cardNumber: "OP01-003",
        notes: "Foil, \"special\"\n日本語",
        createdAt: date,
        updatedAt: date,
        purchases: [
            .init(
                id: UUID(uuid: (85, 14, 132, 0, 226, 155, 65, 212, 167, 22, 68, 102, 85, 68, 0, 1)),
                condition: .nearMint,
                quantity: 2,
                purchasePrice: Decimal(string: "2.50"),
                currency: .usd,
                automaticPriceDate: "2026-07-20"
            ),
            .init(
                id: UUID(uuid: (85, 14, 132, 0, 226, 155, 65, 212, 167, 22, 68, 102, 85, 68, 0, 2)),
                condition: .played,
                quantity: 1
            ),
        ],
        collectionID: nil,
        allocationAdjustments: nil
    )
    static var rows: [CSVImportRow] {
        card.purchases.enumerated().map { CardsCSV.row(card: card, purchase: $0.element, line: $0.offset + 2) }
    }
    static var draft: CSVImportCard { .init(id: UUID(), rows: rows) }
}
