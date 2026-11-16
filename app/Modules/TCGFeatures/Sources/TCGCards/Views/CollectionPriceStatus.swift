import SwiftUI

struct CollectionPriceStatus: View {
    var body: some View {
        Text("Loading the latest prices…", bundle: .module)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.thinMaterial, in: Capsule())
            .allowsHitTesting(false)
    }
}

extension View {
    func collectionPriceStatus(isVisible: Bool, bottomInset: CGFloat) -> some View {
        overlay(alignment: .bottom) {
            if isVisible {
                CollectionPriceStatus().padding(.bottom, bottomInset)
            }
        }
    }
}
