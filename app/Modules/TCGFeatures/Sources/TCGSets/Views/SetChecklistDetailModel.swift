import Observation
import TCGCardDetails
import TCGClient

@MainActor
@Observable
final class SetChecklistDetailModel {
    private(set) var group: CardVariantGroup?
    private(set) var failed = false

    func load(_ card: CatalogSetCard, in destination: CatalogSetDestination, using sets: TCGSets) async {
        failed = false
        let result = await sets.detail(for: card, in: destination)
        guard !Task.isCancelled else { return }
        group = result
        failed = result == nil
    }
}
