import SwiftUI
import TCGCardDetails
import TCGClient
import TCGDesignSystem

struct TCGSearchDetailView: View {
    @Environment(\.dismiss) private var dismiss

    let card: PricedCard

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Done", bundle: .module)
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()
            Divider()
            CardDetailContent(metadata: .init(card: card), price: card) { EmptyView() }

        }
        .background(.background)
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #endif
    }
}
