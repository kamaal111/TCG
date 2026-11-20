import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem

public struct CardDetailMetadata {
    let name: String
    let game: ClientCardGame
    let cardNumber: String
    let illustrator: String?
    let rarity: String?
    let imageURL: URL?

    public init(card: PricedCard) {
        name = card.name
        game = card.game
        cardNumber = card.cardNumber
        illustrator = card.illustrator
        rarity = card.rarity
        imageURL = card.imageURL
    }

    public init(ownedCard: CardWithPrice) {
        name = ownedCard.card.name
        game = ownedCard.card.game
        cardNumber = ownedCard.card.cardNumber
        illustrator = ownedCard.card.illustrator
        rarity = ownedCard.price?.price?.rarity
        imageURL = ownedCard.imageURL
    }
}

public struct CardDetailContent<Supplemental: View>: View {
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @State private var presentedImageURL: URL?
    private let metadata: CardDetailMetadata
    private let card: PricedCard?
    private let ownedQuantities: [CardConditionQuantity]?
    private let supplemental: Supplemental

    public init(
        metadata: CardDetailMetadata,
        price: PricedCard?,
        ownedQuantities: [CardConditionQuantity]?,
        @ViewBuilder supplemental: () -> Supplemental
    ) {
        self.metadata = metadata
        card = price
        self.ownedQuantities = ownedQuantities
        self.supplemental = supplemental()
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                CardArtworkView(
                    url: metadata.imageURL,
                    onExplore: { presentedImageURL = metadata.imageURL }
                )
                .frame(maxWidth: .infinity)
                .frame(height: 280)

                VStack(alignment: .leading, spacing: 12) {
                    Text(metadata.name).font(.title.bold()).accessibilityAddTraits(.isHeader)
                    LabeledContent {
                        Text(metadata.game.title)
                    } label: {
                        Text("Game", bundle: .module)
                    }
                    LabeledContent {
                        Text(metadata.cardNumber)
                    } label: {
                        Text("Card number", bundle: .module)
                    }
                    if let illustrator = metadata.illustrator {
                        LabeledContent {
                            Text(verbatim: illustrator)
                        } label: {
                            Text("Illustrator", bundle: .module)
                        }
                    }
                    if let rarity = metadata.rarity {
                        LabeledContent {
                            Text(rarity)
                        } label: {
                            Text("Rarity", bundle: .module)
                        }
                    }
                }

                supplemental

                if pricePrivacy?.hidePrices != true, let card {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Pricing", bundle: .module).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                        if let ownedQuantities, let values = card.displayConditionValues {
                            ownedPricing(ownedQuantities, values: values)
                        } else if card.conditionPrices != nil {
                            conditionPricing(card.displayConditionPrices)
                        } else {
                            legacyPricing(card)
                        }
                    }

                    pricingDates(card)
                }
            }
            .textSelection(.enabled)
            .padding(24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .cardImage(url: $presentedImageURL)
    }

    private func legacyPricing(_ card: PricedCard) -> some View {
        Group {
            if let headline = card.displayHeadline {
                price(
                    "Lowest Near Mint",
                    amount: headline.amount,
                    currency: headline.currency,
                    conversionUnavailable: card.conversionUnavailable
                )
            }
            if let market = card.displayMarket {
                LabeledContent {
                    Text(market.condition.title)
                } label: {
                    Text("Condition", bundle: .module)
                }
                quoteAmounts(market, conversionUnavailable: card.conversionUnavailable)
            }
            if card.displayHeadline == nil && card.displayMarket?.low == nil
                && card.displayMarket?.market == nil
            {
                Text("No price", bundle: .module).foregroundStyle(.secondary)
            }
        }
    }

    private func pricingDates(_ card: PricedCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent {
                Text(card.pricedOn, format: .dateTime.year().month().day())
            } label: {
                Text("Pricing date", bundle: .module)
            }
            LabeledContent {
                Text(card.fetchedAt, format: .dateTime.year().month().day().hour().minute())
            } label: {
                Text("Last fetched", bundle: .module)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private func ownedPricing(_ quantities: [CardConditionQuantity], values: [ConditionValue]) -> some View {
        ForEach(quantities, id: \.condition) { quantity in
            LabeledContent {
                if let value = values.first(where: { $0.condition == quantity.condition }) {
                    VStack(alignment: .trailing, spacing: 4) {
                        CurrencyAmount(
                            value.amount,
                            currency: value.currency,
                            label: nil,
                            conversionUnavailable: value.conversionUnavailable == true
                        )
                        .monospacedDigit()
                        Text("Per copy", bundle: .module).font(.caption).foregroundStyle(.secondary)
                        if value.condition == .mint {
                            Text("Near Mint proxy", bundle: .module).font(.caption).foregroundStyle(.secondary)
                        }
                        switch value.basis {
                        case .market: EmptyView()
                        case .low:
                            Text("Lowest available price", bundle: .module).font(.caption).foregroundStyle(.secondary)
                        case .adjusted, .interpolated:
                            Text("Estimated", bundle: .module).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("No price", bundle: .module).foregroundStyle(.secondary)
                }
            } label: {
                Text("\(quantity.condition.title) ×\(quantity.quantity)", bundle: .module)
            }
        }
    }

    @ViewBuilder
    private func conditionPricing(_ quotes: [MarketPrice]) -> some View {
        if !quotes.contains(where: { $0.low != nil || $0.market != nil }) {
            Text("No price", bundle: .module).foregroundStyle(.secondary)
        }
        ForEach(quotes, id: \.condition) { quote in
            VStack(alignment: .leading, spacing: 8) {
                Text(quote.condition.title).font(.headline).accessibilityAddTraits(.isHeader)
                quoteAmounts(quote, conversionUnavailable: conversionUnavailable(for: quote))
            }
        }
    }

    @ViewBuilder
    private func quoteAmounts(_ quote: MarketPrice, conversionUnavailable: Bool) -> some View {
        if let low = quote.low {
            price("Low", amount: low, currency: quote.currency, conversionUnavailable: conversionUnavailable)
        }
        if let amount = quote.market {
            price("Market", amount: amount, currency: quote.currency, conversionUnavailable: conversionUnavailable)
        }
        if let movement = quote.trend7d {
            movementRow(
                "7-day change",
                movement: movement,
                currency: quote.currency,
                conversionUnavailable: conversionUnavailable
            )
        }
        if let movement = quote.trend30d {
            movementRow(
                "30-day change",
                movement: movement,
                currency: quote.currency,
                conversionUnavailable: conversionUnavailable
            )
        }
    }

    private func conversionUnavailable(for quote: MarketPrice) -> Bool {
        guard let display = card?.display else { return false }
        return quote.currency != display.preferredCurrency
    }

    private func price(
        _ title: LocalizedStringKey,
        amount: Double,
        currency: Currency,
        conversionUnavailable: Bool
    ) -> some View {
        LabeledContent {
            CurrencyAmount(
                amount,
                currency: currency,
                label: nil,
                conversionUnavailable: conversionUnavailable
            )
            .monospacedDigit()
        } label: {
            Text(title, bundle: .module)
        }
    }

    private func movementRow(
        _ title: LocalizedStringKey,
        movement: PriceMovement,
        currency: Currency,
        conversionUnavailable: Bool
    ) -> some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 4) {
                CurrencyAmount(
                    movement.priceChange,
                    currency: currency,
                    label: nil,
                    conversionUnavailable: conversionUnavailable
                )
                Text(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))
                Label(movement.trend.title, systemImage: movement.trend.systemImage)
                    .font(.caption)
            }
            .monospacedDigit()
        } label: {
            Text(title, bundle: .module)
        }
    }
}
