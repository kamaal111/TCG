import SwiftUI

struct CollectionEditingControls: View {
    let editLayout: () -> Void

    var body: some View {
        HStack {
            Button(action: editLayout) {
                Label {
                    Text("Page dimensions…", bundle: .module)
                } icon: {
                    Image(systemName: "rectangle.grid.3x3")
                }
            }
            .buttonStyle(.bordered)
            .help(Text("Page dimensions…", bundle: .module))
            Spacer()
        }
    }
}
