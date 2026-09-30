import SwiftUI

struct TCGSearchHelpExampleView: View {
    private let title: LocalizedStringKey
    private let query: String
    private let detail: LocalizedStringKey

    init(_ title: LocalizedStringKey, query: String, detail: LocalizedStringKey) {
        self.title = title
        self.query = query
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title, bundle: .module)
                .font(.headline)
            Text(verbatim: query)
                .font(.body.monospaced())
                .textSelection(.enabled)
            Text(detail, bundle: .module)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}
