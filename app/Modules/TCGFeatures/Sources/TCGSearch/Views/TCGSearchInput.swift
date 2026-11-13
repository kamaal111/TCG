import SwiftUI
import TCGClient
import TCGModels

struct TCGSearchInput: View {
    @Binding var query: String
    @Binding var mode: ClientCardSearchMode
    let game: ClientCardGame
    @Binding var languages: Set<ClientCardLanguage>
    @Binding var gameSelection: CardGame
    let availableSetNames: [String]
    @Binding var setNames: Set<String>
    let isFocused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    @State private var isShowingSearchHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TCGSearchFilters(
                game: game,
                languages: $languages,
                gameSelection: $gameSelection,
                availableSetNames: availableSetNames,
                setNames: $setNames
            )
            if game == .pokemon {
                Picker(selection: $mode) {
                    Text("Cards", bundle: .module).tag(ClientCardSearchMode.card)
                    Text("Illustrator", bundle: .module).tag(ClientCardSearchMode.illustrator)
                } label: {
                    Text("Search by", bundle: .module)
                }
                .pickerStyle(.segmented)
            }
            searchField
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(text: $query) {
                    Text(
                        mode == .illustrator
                            ? LocalizedStringKey("Illustrator name")
                            : game == .pokemon
                                ? LocalizedStringKey("Card name or set + number")
                                : LocalizedStringKey("Card name or number"),
                        bundle: .module
                    )
                }
                .textFieldStyle(.plain)
                .focused(isFocused)
                .autocorrectionDisabled()
                .onSubmit(onSubmit)
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                #endif
                if !query.isEmpty {
                    Button {
                        query = ""
                        isFocused.wrappedValue = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Text("Clear search", bundle: .module))
                }
            }
            .padding(10)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.quaternary)
            }

            Button {
                isShowingSearchHelp = true
            } label: {
                Image(systemName: "info.circle")
                    .font(.title3)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(Text("How to search", bundle: .module))
            #if os(macOS)
                .help(Text("How to search", bundle: .module))
                .popover(isPresented: $isShowingSearchHelp) {
                    TCGSearchHelpView(game: game)
                    .frame(width: 380)
                }
            #else
                .sheet(isPresented: $isShowingSearchHelp) {
                    TCGSearchHelpView(game: game)
                    .presentationDetents([.medium, .large])
                }
            #endif
        }
    }
}
