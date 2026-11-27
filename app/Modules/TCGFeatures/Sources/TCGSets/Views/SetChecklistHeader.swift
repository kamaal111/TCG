import SwiftUI
import TCGClient

struct SetChecklistHeader: View {
    let summary: CatalogSetSummary?
    @Binding var filter: CatalogChecklistFilter

    var body: some View {
        if let summary {
            SetLogo(url: summary.logo ?? summary.symbol)
                .frame(maxWidth: .infinity)
                .frame(height: 72)
            SetProgressView(progress: summary.progress)
        }
        Picker(selection: $filter) {
            ForEach(CatalogChecklistFilter.allCases) { option in
                option.title.tag(option)
            }
        } label: {
            Text("Ownership", bundle: .module)
        }
        .pickerStyle(.segmented)
    }
}
