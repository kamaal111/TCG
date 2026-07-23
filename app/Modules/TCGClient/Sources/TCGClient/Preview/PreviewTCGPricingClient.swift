//
//  PreviewTCGPricingClient.swift
//  TCGClient
//

import Foundation

struct PreviewTCGPricingClient: TCGPricingClient {
    let outcome: PreviewTCGPricingOutcome

    func search(game: ClientCardGame, query: String) async -> Result<CardSearchResult, SearchPricingErrors> {
        switch outcome {
        case .success:
            .success(
                CardSearchResult(
                    matches: Self.samplePricedCards.filter { $0.game == game }
                )
            )
        case .empty, .noResults:
            .success(
                CardSearchResult(matches: [])
            )
        case .unauthorized:
            .failure(.unauthorized)
        case .serverUnavailable:
            .failure(.unavailable)
        }
    }

    static let samplePricedCards = [
        PricedCard(
            id: "00000000-0000-0000-0000-000000000001",
            game: .onePiece,
            name: "Marshall.D.Teach",
            cardNumber: "OP09-093",
            rarity: "Manga Rare",
            headline: .init(amount: 8.75, currency: .usd),
            market: .init(
                currency: .usd,
                low: 8.75,
                market: 9.60,
                trend7d: .init(priceChange: 0.10, percentChange: 1.05),
                trend30d: .init(priceChange: 0.85, percentChange: 9.71)
            ),
            pricedOn: fixedDate,
            fetchedAt: fixedDate
        ),
        PricedCard(
            id: "00000000-0000-0000-0000-000000000002",
            game: .pokemon,
            name: "Giratina VSTAR",
            cardNumber: "GG69",
            rarity: "Secret Rare",
            headline: .init(amount: 146.69, currency: .usd),
            market: .init(
                currency: .usd,
                low: 146.69,
                market: 172.42,
                trend7d: .init(priceChange: 7.36, percentChange: 4.46),
                trend30d: .init(priceChange: 13.88, percentChange: 8.75)
            ),
            pricedOn: fixedDate,
            fetchedAt: fixedDate
        ),
    ]

    private static let fixedDate = Date(timeIntervalSince1970: 1_753_267_800)
}
