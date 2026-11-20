import OpenAPIRuntime

public protocol TCGWishlistClient: Sendable {
    func list(_ request: WishlistListQuery) async -> Result<WishlistPage, WishlistError>

    func save(_ payload: SaveWishlistPrinting) async -> Result<Void, WishlistError>

    func remove(printingKey: String) async -> Result<Void, WishlistError>
}

extension TCGWishlistClient {
    public func list(cursor: String?, query: String?) async -> Result<WishlistPage, WishlistError> {
        let filters = CardListFilters(game: nil, setNames: [], illustrators: [], query: query)
        return await list(.init(filters: filters, cursor: cursor))
    }

    public func list(cursor: String?) async -> Result<WishlistPage, WishlistError> {
        await list(cursor: cursor, query: nil)
    }
}

struct TCGWishlistClientImpl: TCGWishlistClient {
    let client: Client

    func list(_ request: WishlistListQuery) async -> Result<WishlistPage, WishlistError> {
        do {
            let query = Operations.GetAppApiWishlist.Input.Query(
                illustrator: request.filters.illustratorParameters,
                game: request.filters.game.map(Self.makeListGame),
                setName: request.filters.setNameParameters,
                query: request.filters.query,
                cursor: request.cursor
            )
            switch try await client.getAppApiWishlist(query: query) {
            case .ok(let response):
                guard let page = try? response.body.json, page.entries.allSatisfy({ $0.printingKey != nil }) else {
                    return .failure(.unavailable)
                }
                return .success(
                    WishlistPage(
                        entries: page.entries.map(PricedCardMapper.makePricedCard),
                        nextCursor: page.nextCursor,
                        availableSetNames: Set(page.availableSetNames ?? []),
                        availableIllustrators: Set(page.availableIllustrators ?? [])
                    )
                )
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    private static func makeListGame(_ game: ClientCardGame) -> Operations.GetAppApiWishlist.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    func save(_ payload: SaveWishlistPrinting) async -> Result<Void, WishlistError> {
        do {
            switch try await client.postAppApiWishlist(body: .json(.init(pricedCardId: payload.pricedCardID))) {
            case .noContent: return .success(())
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func remove(printingKey: String) async -> Result<Void, WishlistError> {
        do {
            switch try await client.deleteAppApiWishlistPrintingKey(path: .init(printingKey: printingKey)) {
            case .noContent: return .success(())
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }
}
