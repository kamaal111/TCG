import SwiftUI
import TCGClient
import Textual

struct TCGSearchHelpView: View {
    @Environment(\.dismiss) private var dismiss

    private let document: Result<String, TCGSearchHelpDocument.LoadError>

    init(game: ClientCardGame) {
        document = TCGSearchHelpDocument.load(game: game)
    }

    @ViewBuilder
    var body: some View {
        #if os(macOS)
            content
                .frame(height: 520)
        #else
            VStack(spacing: 0) {
                HStack {
                    Text("How to search", bundle: .module)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Text("Done", bundle: .module)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                }
                .padding([.top, .horizontal], 24)
                content
            }
        #endif
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                #if os(macOS)
                    Text("How to search", bundle: .module)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                #endif

                switch document {
                case .success(let markdown):
                    StructuredText(markdown: markdown)
                        .textual.headingStyle(SearchHelpHeadingStyle())
                        .textual.textSelection(.enabled)
                case .failure:
                    Text("Search help could not be loaded.", bundle: .module)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
    }
}

private struct SearchHelpHeadingStyle: StructuredText.HeadingStyle {
    func makeBody(configuration: Configuration) -> some View {
        StructuredText.DefaultHeadingStyle.default.makeBody(configuration: configuration)
            .accessibilityAddTraits(.isHeader)
    }
}
