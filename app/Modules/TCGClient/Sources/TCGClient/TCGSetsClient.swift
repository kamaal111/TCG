import Foundation

public struct CatalogSetReference: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct CatalogSetProgress: Hashable, Sendable {
    public let collected: Int
    public let total: Int

    public init(collected: Int, total: Int) {
        self.collected = collected
        self.total = total
    }
}

public struct CatalogSetSummary: Hashable, Sendable, Identifiable {
    public let set: CatalogSetReference
    public let logo: URL?
    public let symbol: URL?
    public let language: String?
    public let progress: CatalogSetProgress

    public var id: String { self.set.id }

    public init(
        set: CatalogSetReference,
        logo: URL?,
        symbol: URL?,
        language: String?,
        progress: CatalogSetProgress
    ) {
        self.set = set
        self.logo = logo
        self.symbol = symbol
        self.language = language
        self.progress = progress
    }
}

public struct CatalogSetCard: Hashable, Sendable, Identifiable {
    public let number: String
    public let printedNumber: String
    public let name: String
    public let imageURL: URL?
    public let owned: Bool

    public var id: String { number }

    public init(number: String, printedNumber: String, name: String, imageURL: URL?, owned: Bool) {
        self.number = number
        self.printedNumber = printedNumber
        self.name = name
        self.imageURL = imageURL
        self.owned = owned
    }
}

public struct CatalogSetPage<Entry: Sendable>: Sendable {
    public let entries: [Entry]
    public let nextCursor: String?
}

public struct CatalogChecklistPage: Sendable {
    public let cards: CatalogSetPage<CatalogSetCard>
    public let set: CatalogSetSummary
}

public enum CatalogChecklistFilter: String, Codable, CaseIterable, Identifiable, Sendable {
    case all, missing, owned

    public var id: Self { self }
}

public enum CatalogSetsError: Error, Equatable, Sendable {
    case invalidRequest([TCGClientValidationIssue])
    case unauthorized
    case notFound
    case unavailable
}

public protocol TCGSetsClient: Sendable {
    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError>

    func checklist(
        game: ClientCardGame,
        setID: String,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError>

    func detail(
        game: ClientCardGame,
        setID: String,
        number: String
    ) async -> Result<[PricedCard], CatalogSetsError>
}

struct TCGSetsClientImpl: TCGSetsClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        do {
            let response = try await client.getAppApiSets(
                query: .init(
                    game: game == .pokemon ? .pokemon : .onePiece,
                    query: query,
                    section: inProgress ? .inProgress : .all,
                    cursor: cursor
                )
            )
            switch response {
            case .ok(let response):
                guard let body = try? response.body.json else { return .failure(.unavailable) }
                return .success(.init(entries: body.entries.map(Self.makeSummary), nextCursor: body.nextCursor))
            case .badRequest(let response):
                return .failure(
                    .invalidRequest(
                        TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                    )
                )
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .serviceUnavailable, .undocumented: return .failure(.unavailable)
            }
        } catch {
            return .failure(.unavailable)
        }
    }

    func checklist(
        game: ClientCardGame,
        setID: String,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError> {
        do {
            let response = try await client.getAppApiSetChecklist(
                path: .init(game: game == .pokemon ? .pokemon : .onePiece, setId: setID),
                query: .init(filter: .init(rawValue: filter.rawValue), cursor: cursor)
            )
            switch response {
            case .ok(let response):
                guard let body = try? response.body.json else { return .failure(.unavailable) }
                let entries = body.entries.map { card in
                    CatalogSetCard(
                        number: card.number,
                        printedNumber: card.printedNumber,
                        name: card.name,
                        imageURL: card.imageUrl.flatMap(URL.init(string:)),
                        owned: card.owned
                    )
                }
                return .success(
                    .init(
                        cards: .init(entries: entries, nextCursor: body.nextCursor),
                        set: Self.makeSummary(body.set)
                    )
                )
            case .badRequest(let response):
                return .failure(
                    .invalidRequest(
                        TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                    )
                )
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .serviceUnavailable, .undocumented: return .failure(.unavailable)
            }
        } catch {
            return .failure(.unavailable)
        }
    }

    func detail(
        game: ClientCardGame,
        setID: String,
        number: String
    ) async -> Result<[PricedCard], CatalogSetsError> {
        do {
            let response = try await client.getAppApiSetCardDetail(
                path: .init(game: game == .pokemon ? .pokemon : .onePiece, setId: setID, number: number)
            )
            switch response {
            case .ok(let response):
                guard let body = try? response.body.json else { return .failure(.unavailable) }
                return .success(body.printings.map(PricedCardMapper.makePricedCard))
            case .badRequest(let response):
                return .failure(
                    .invalidRequest(
                        TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                    )
                )
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .serviceUnavailable, .undocumented: return .failure(.unavailable)
            }
        } catch {
            return .failure(.unavailable)
        }
    }

    private static func makeSummary(_ set: Components.Schemas.SetSummary) -> CatalogSetSummary {
        CatalogSetSummary(
            set: .init(id: set.id, name: set.name),
            logo: set.logo.flatMap(URL.init(string:)),
            symbol: set.symbol.flatMap(URL.init(string:)),
            language: set.language,
            progress: .init(collected: set.collected, total: set.total)
        )
    }
}
