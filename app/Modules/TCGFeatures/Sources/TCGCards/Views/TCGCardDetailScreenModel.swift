import Foundation
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

        let model = TCGCardFormScreenModel(mode: .edit(card.card), initialValues: nil)
        if let price = card.price.price { model.applyMarketDefault(price) }
        editor = model
    }

    func save(using cards: TCGCards) async {
        guard let editor else { return }
        guard await editor.submit(using: cards) else { return }
        guard let saved = editor.savedCard else {
            preconditionFailure("A successful edit must return the saved card.")
        }

        card = saved
        self.editor = nil
    }
}
