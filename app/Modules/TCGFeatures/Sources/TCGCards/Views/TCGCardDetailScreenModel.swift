import Foundation
import KamaalExtensions
import Observation
import TCGClient

@MainActor
@Observable
final class TCGCardDetailScreenModel {
    private(set) var card: CardWithPrice
    private(set) var editor: TCGCardFormScreenModel?

    init(card: CardWithPrice) {
        self.card = card
    }

    func edit() {
        guard editor == nil else { return }

        editor = TCGCardFormScreenModel(mode: .edit(card.card), initialValues: nil)
    }

    func save(using cards: TCGCards) async {
        guard let editor else { return }
        guard await editor.submit(using: cards) else { return }
        guard let saved = cards.cards.find(by: \.card.id, is: card.card.id) else {
            preconditionFailure("A saved collection card must remain in the collection.")
        }

        card = saved
        self.editor = nil
    }
}
