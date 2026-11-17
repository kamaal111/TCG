import Observation
import SwiftUI
import TCGClient

@MainActor
@Observable
public final class TCGWishlist {
    private let client: TCGWishlistClient

    public init(client: TCGWishlistClient) {
        self.client = client
    }

    func page(after cursor: String?) async -> Result<WishlistPage, WishlistError> {
        await client.list(cursor: cursor)
    }

    func save(pricedCardID: String) async -> Result<Void, WishlistError> {
        await client.save(.init(pricedCardID: pricedCardID))
    }

    func remove(printingKey: String) async -> Result<Void, WishlistError> {
        await client.remove(printingKey: printingKey)
    }
}

extension EnvironmentValues {
    @Entry public var tcgWishlist: TCGWishlist? = nil
}
