import SwiftUI

struct BinderPageActions: View {
    let addPage: () -> Void
    let selectedPageNumber: Int?
    let insertPage: () -> Void

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
            if let selectedPageNumber {
                Button(action: insertPage) {
                    Label {
                        Text("Insert page before", bundle: .module)
                    } icon: {
                        Image(systemName: "rectangle.stack.badge.plus")
                    }
                }
                .help(Text("Insert before page \(selectedPageNumber)", bundle: .module))
                .accessibilityLabel(Text("Insert before page \(selectedPageNumber)", bundle: .module))
            }
            Spacer()
        }
    }
}
