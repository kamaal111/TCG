import SwiftUI

struct CollectionAllocationNotice: View {
    let count: Int
    let dismiss: () -> Void

    var body: some View {
        HStack {
            Text(
                "\(count) placed copies were removed from later slots to match the quantity you own.",
                bundle: .module
            )
            Button {
                dismiss()
            } label: {
                Text("Dismiss", bundle: .module)
            }
        }
        .padding()
        .background(.regularMaterial)
    }
}
