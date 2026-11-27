import SwiftUI
import TCGClient

struct CatalogSetRow: View {
    let summary: CatalogSetSummary

    var body: some View {
        HStack(spacing: 12) {
            SetLogo(url: summary.logo ?? summary.symbol)
                .frame(width: 62, height: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(summary.set.name)
                    .font(.headline)
                if let language = summary.language {
                    Text(Locale.current.localizedString(forLanguageCode: language) ?? language)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                SetProgressView(progress: summary.progress)
            }
        }
    }
}
