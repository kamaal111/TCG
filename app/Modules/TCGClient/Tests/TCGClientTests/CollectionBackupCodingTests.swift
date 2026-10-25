import Foundation
import Testing

@testable import TCGClient

struct CollectionBackupCodingTests {
    @Test func `Backup results preserve identities purchases and fractional dates`() throws {
        let card = ClientCardFixtures.card(
            id: ClientTestIDs.primary,
            createdAt: Date(timeIntervalSince1970: 1_750_000_000.125)
        )
        let backup = CollectionBackup(version: 1, collections: [], cards: [ImportCardPayload(card: card)])
        let encoded = try CollectionBackupCoding.encode(backup).get()
        let decoded = try CollectionBackupCoding.decode(encoded).get()
        #expect(decoded.version == backup.version)
        #expect(decoded.cards == backup.cards)
        #expect(decoded.collections.isEmpty)
    }

    @Test(arguments: ["not json", "{}", "{\"version\":1,\"collections\":[],\"cards\":[{}]}"])
    func `Malformed backups return a decoding failure`(json: String) {
        #expect(throws: CollectionBackupCodingError.self) {
            try CollectionBackupCoding.decode(Data(json.utf8)).get()
        }
    }

    @Test func `Invalid backup dates return decoding failures without escaping the codec`() throws {
        let backup = CollectionBackup(
            version: 1,
            collections: [],
            cards: [ImportCardPayload(card: PreviewTCGCardsClient.sampleCards[0])]
        )
        let data = try CollectionBackupCoding.encode(backup).get()
        var wire = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var cards = try #require(wire["cards"] as? [[String: Any]])
        cards[0]["created_at"] = "not a date"
        wire["cards"] = cards
        let invalid = try JSONSerialization.data(withJSONObject: wire)
        #expect(throws: CollectionBackupCodingError.self) {
            try CollectionBackupCoding.decode(invalid).get()
        }
    }

}
