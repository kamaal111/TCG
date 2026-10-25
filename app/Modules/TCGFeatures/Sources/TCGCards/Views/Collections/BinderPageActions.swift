import SwiftUI

struct BinderPageActions: View {
    let addPage: () -> Void

    var body: some View {
        HStack {
            Button(action: addPage) {
                Label {
                    Text("Empty page", bundle: .module)
                } icon: {
                    Image(systemName: "plus")
                }
            }
            .help(Text("Add an empty page", bundle: .module))
            Spacer()
        }
    }
}
