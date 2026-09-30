import SwiftUI
import TCGClient

struct TCGSearchInput: View {
    @Binding var query: String
    let game: ClientCardGame
    let onSubmit: () -> Void

    @State private var isShowingSearchHelp = false
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(text: $query) {
                    Text(
                        game == .pokemon
                            ? LocalizedStringKey("Card name or set + number")
                            : LocalizedStringKey("Card name or number"),
                        bundle: .module
                    )
                }
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .autocorrectionDisabled()
                .onSubmit(onSubmit)
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                #endif
                if !query.isEmpty {
                    Button {
                        query = ""
                        isSearchFocused = true
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
