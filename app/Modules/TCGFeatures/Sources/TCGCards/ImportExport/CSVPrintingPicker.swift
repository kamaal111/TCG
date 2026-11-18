import SwiftUI
import TCGClient
import TCGDesignSystem

struct CSVPrintingPicker: View {
    let printings: [PricedCard]
    let selectedID: String?
    let onSelect: (PricedCard) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(printings) { printing in
                    Button {
                        onSelect(printing)
                    } label: {
                        HStack(spacing: 12) {
                            CardImageView(url: printing.imageURL)
                                .frame(width: 50, height: 70)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(printing.variantName ?? printing.name).font(.headline)
                                Text(printing.cardNumber).foregroundStyle(.secondary)
                                if let illustrator = printing.illustrator {
                                    Text(illustrator).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if printing.id == selectedID {
                                Image(systemName: "checkmark")
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(printing.id == selectedID ? .isSelected : [])
                }
            }
            .padding()
        }
        .tcgSheet(Text("Choose Printing", bundle: .module), closeLabel: Text("Cancel", bundle: .module))
        #if os(macOS)
            .frame(minWidth: 380, minHeight: 300)
        #endif
    }
}
