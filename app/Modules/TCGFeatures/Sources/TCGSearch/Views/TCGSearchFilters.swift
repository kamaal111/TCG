import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

struct TCGSearchFilters: View {
    let game: ClientCardGame
    @Binding var languages: Set<ClientCardLanguage>
    @Binding var gameSelection: CardGame

    var body: some View {
        TCGFilterMenu(gameTitle: Text(verbatim: gameSelection.title), summary: languageSummary) {
            Picker(selection: $gameSelection) {
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(verbatim: game.title).tag(game)
                }
            } label: {
                Text("Game", bundle: .module)
            }
            Section {
                ForEach(ClientCardLanguage.supported(for: game), id: \.self) { language in
                    Toggle(isOn: languageBinding(language)) {
                        languageLabel(language)
                    }
                    #if os(iOS)
                        .menuActionDismissBehavior(.disabled)
                    #endif
                }
            } header: {
                Text("Languages", bundle: .module)
            }
        }
    }

    private func languageBinding(_ language: ClientCardLanguage) -> Binding<Bool> {
        Binding(
            get: { languages.contains(language) },
            set: { selected in
                if selected {
                    languages.insert(language)
                } else {
                    languages.remove(language)
                }
            }
        )
    }

    private var languageSummary: Text {
        let selected = ClientCardLanguage.normalized(languages, for: game)
        guard let language = selected.first else { return Text("All languages", bundle: .module) }
        return languageLabel(language)
    }

    private func languageLabel(_ language: ClientCardLanguage) -> Text {
        switch language {
        case .english: Text("English", bundle: .module)
        case .japanese: Text("Japanese", bundle: .module)
        }
    }
}
