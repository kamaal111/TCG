import Foundation
import Testing

@testable import TCGSearch

@Suite("TCGSearch Help Document Tests")
struct TCGSearchHelpDocumentTests {
    @Test
    func `Pokemon help loads its bundled query examples`() throws {
        let markdown = try TCGSearchHelpDocument.load(game: .pokemon).get()

        #expect(markdown.contains("## Card name"))
        #expect(markdown.contains("Charizard ex 199"))
        #expect(markdown.contains("sv5m 072/071"))
        #expect(markdown.contains("sv5m_ja 72"))
        #expect(!markdown.contains("OP14-069"))
    }

    @Test
    func `One Piece help loads its bundled query examples`() throws {
        let markdown = try TCGSearchHelpDocument.load(game: .onePiece).get()

        #expect(markdown.contains("## Card name"))
        #expect(markdown.contains("Monkey D. Luffy"))
        #expect(markdown.contains("OP14-069"))
        #expect(markdown.contains("Nami OP01-016"))
        #expect(!markdown.contains("Charizard"))
    }

    @Test
    func `Missing help documents report an unavailable error`() {
        #expect(throws: TCGSearchHelpDocument.LoadError.unavailable) {
            try TCGSearchHelpDocument.load(game: .pokemon, bundle: .main).get()
        }
    }
}
