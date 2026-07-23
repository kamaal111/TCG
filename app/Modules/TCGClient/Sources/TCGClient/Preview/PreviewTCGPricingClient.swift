//
//  PreviewTCGPricingClient.swift
//  TCGClient
//

import Foundation

struct PreviewTCGPricingClient: TCGPricingClient {
    let outcome: PreviewTCGPricingOutcome

    func search(game: CardGame, query: String) async -> Result<CardSearchResult, SearchPricingErrors> {
        switch outcome {
        case .success:
            .success(
                CardSearchResult(
                    query: query,
                    normalizedQuery: query,
                    game: game,
                    status: .ok,
                    matches: Self.samplePricedCards.filter { $0.game == game }
                )
            )
        case .empty, .noResults:
            .success(
                CardSearchResult(
                    query: query,
                    normalizedQuery: query,
                    game: game,
                    status: .noResults,
                    matches: []
                )
            )
        case .unauthorized:
            .failure(.unauthorized)
        case .serverUnavailable:
            .failure(.unavailable)
        }
    }

    func ownedPrices(game: CardGame?) async -> Result<[OwnedCardPrice], OwnedPricesErrors> {
        switch outcome {
        case .success, .noResults:
            .success(Self.sampleOwnedPrices.filter { game == nil || $0.price?.game == game })
        case .empty:
            .success([])
        case .unauthorized:
            .failure(.unauthorized)
        case .serverUnavailable:
            .failure(.unavailable)
        }
    }

    static let samplePricedCards = [
        PricedCard(
            tcggoCardId: "one-piece-marshall-d-teach-op09-093",
            game: .onePiece,
            name: "Marshall.D.Teach",
            cardNumber: "OP09-093",
            rarity: "Manga Rare",
            headline: .init(amount: 734.90, currency: "EUR"),
            cardmarket: .init(
                currency: "EUR",
                lowestNearMint: 734.90,
                average7d: 748.20,
                average30d: 720.40,
                trend: .up
            ),
            pricedOn: "2026-07-23",
            fetchedAt: fixedDate
        ),
        PricedCard(
            tcggoCardId: "pokemon-giratina-vstar-gg69",
            game: .pokemon,
            name: "Giratina VSTAR",
            cardNumber: "GG69",
            rarity: "Secret Rare",
            headline: .init(amount: 146.69, currency: "EUR"),
            cardmarket: .init(
                currency: "EUR",
                lowestNearMint: 146.69,
                average7d: 151.24,
                average30d: 143.88,
                trend: .up
            ),
            pricedOn: "2026-07-23",
            fetchedAt: fixedDate
        ),
    ]

    static let sampleOwnedPrices = [
        OwnedCardPrice(cardId: "preview-card-1", status: .priced, price: samplePricedCards[0]),
        OwnedCardPrice(cardId: "preview-card-2", status: .priced, price: samplePricedCards[1]),
    ]

    private static let fixedDate = Date(timeIntervalSince1970: 1_753_267_800)
}
