import SwiftUI
import TCGClient

struct CollectionContentView: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let actions: CollectionNavigationActions
    @Binding var isEditing: Bool

    var body: some View {
        VStack(spacing: 0) {
            if let selected = collections.selected {
                CollectionViewPicker(collection: selected, collections: collections)
                    .padding(.horizontal)
                    .padding(.top)
                if isEditing {
                    CollectionEditingControls(editLayout: actions.editLayout)
                        .padding(.horizontal)
                        .padding(.top)
                }
            }
            collectionContent
        }
        .refreshable {
            await collections.refresh(using: cards)
        }
        .toolbar {
            #if os(iOS)
                ToolbarItem(placement: .topBarLeading) {
                    CollectionSwitcher(collections: collections, actions: actions)
                }
            #endif
            ToolbarItemGroup(placement: .primaryAction) {
                if collections.selected == nil && collections.selectedID == nil {
                    #if os(macOS)
                        CollectionOptionsMenu(collections: collections, actions: actions)
                    #endif
                } else if collections.selected != nil {
                    if isEditing {
                        CollectionOptionsMenu(collections: collections, actions: actions)
                    }
                    Button {
                        isEditing.toggle()
                    } label: {
                        if isEditing {
                            Text("Done", bundle: .module)
                        } else {
                            Text("Edit collection", bundle: .module)
                        }
                    }
                    .help(isEditing ? Text("Done", bundle: .module) : Text("Edit collection", bundle: .module))
                    .disabled(collections.isWorking)
                }
            }
        }
    }

    private var collectionContent: some View {
        Group {
            if let selected = collections.selected {
                if collections.view(for: selected.id) == .binder {
                    TCGBinderScreen(collection: selected).id(selected.id)
                } else {
                    TCGCardsListScreen().id(selected.id)
                }
            } else if collections.selectedID != nil {
                ProgressView()
            } else {
                TCGCardsListScreen()
            }
        }
    }
}
