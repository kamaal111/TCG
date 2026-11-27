import SwiftUI
import TCGClient

extension CatalogChecklistFilter {
    var title: Text {
        switch self {
        case .all: Text("All", bundle: .module)
        case .missing: Text("Missing", bundle: .module)
        case .owned: Text("Owned", bundle: .module)
        }
    }
}
