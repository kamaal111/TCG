import SwiftUI

struct BinderPageActions: View {
    let addPage: () -> Void
    let selectedPageNumber: Int?
    let insertPage: (BinderLayout.PageInsertion) -> Void

    var body: some View {
        HStack {
            if let selectedPageNumber {
                pageButton(Text("Add page before", bundle: .module)) { insertPage(.before) }
                    .help(Text("Add page before page \(selectedPageNumber)", bundle: .module))
                    .accessibilityLabel(Text("Add page before page \(selectedPageNumber)", bundle: .module))
                Spacer()
                pageButton(Text("Add page after", bundle: .module)) { insertPage(.after) }
                    .help(Text("Add page after page \(selectedPageNumber)", bundle: .module))
                    .accessibilityLabel(Text("Add page after page \(selectedPageNumber)", bundle: .module))
            } else {
                pageButton(Text("Add page", bundle: .module), action: addPage)
                Spacer()
            }
        }
    }

    private func pageButton(_ title: Text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label {
                title
            } icon: {
                Image(systemName: "plus")
            }
        }
    }
}
