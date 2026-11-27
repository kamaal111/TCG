import SwiftUI
import TCGClient

struct SetProgressView: View {
    let progress: CatalogSetProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(progress.collected) of \(progress.total) collected", bundle: .module)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if progress.total > 0 {
                ProgressView(value: Double(progress.collected), total: Double(progress.total))
                    .accessibilityHidden(true)
            }
        }
    }
}
