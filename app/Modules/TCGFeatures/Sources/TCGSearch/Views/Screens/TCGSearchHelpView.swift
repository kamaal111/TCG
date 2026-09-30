import SwiftUI
import TCGClient

struct TCGSearchHelpView: View {
    @Environment(\.dismiss) private var dismiss

    let game: ClientCardGame

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

                if game == .pokemon {
                    TCGPokemonSearchHelpView()
                } else {
                    TCGOnePieceSearchHelpView()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
    }
}
