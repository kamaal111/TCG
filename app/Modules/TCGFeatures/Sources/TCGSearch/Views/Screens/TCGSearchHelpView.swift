import KamaalUI
import SwiftUI
import TCGClient
import TCGDesignSystem
import Textual

struct TCGSearchHelpView: View {
    private let document: Result<String, TCGSearchHelpDocument.LoadError>

    init(game: ClientCardGame) {
        document = TCGSearchHelpDocument.load(game: game, bundle: .module)
    }

    @ViewBuilder
    var body: some View {
        #if os(macOS)
            content
                .frame(height: 520)
        #else
            content
                .tcgSheet(
                    Text("How to search", bundle: .module),
                    closeLabel: Text("Done", bundle: .module),
                    closeDisabled: false,
                    onClose: nil
                )
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
            .ktakeWidthEagerly(alignment: .leading)
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
