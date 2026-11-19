import SwiftUI
import TCGDesignSystem

struct CollectionOptionsMenu: View {
    let collections: TCGCollections
    let actions: CollectionNavigationActions

    var body: some View {
        TCGNavigationMenu {
            if let selected = collections.selected {
                if !selected.isUnfiled {
                    Button {
                        actions.rename(selected)
                    } label: {
                        Text("Rename collection", bundle: .module)
                    }
                    Button(role: .destructive) {
                        actions.delete()
                    } label: {
                        Text("Delete collection", bundle: .module)
                    }
                }
            }
            #if os(macOS)
                Button {
                    actions.create()
                } label: {
                    Text("New collection", bundle: .module)
                }
            #endif
        } label: {
            Label {
                Text("Collection options", bundle: .module)
            } icon: {
                Image(systemName: "ellipsis.circle")
            }
        }
        .help(Text("Collection options", bundle: .module))
        .disabled(collections.isWorking)
    }

}
