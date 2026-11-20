import SwiftUI
import TCGModels

public struct TCGCollectionFilters: View {
    @Bindable private var state: CardListFilterState

    private let availableSets: Set<String>
    private let availableIllustrators: Set<String>

    public init(state: CardListFilterState, availableSets: Set<String>, availableIllustrators: Set<String>) {
        self.state = state
        self.availableSets = availableSets
        self.availableIllustrators = availableIllustrators
    }

    public var body: some View {
        TCGFilterMenu(gameTitle: gameTitle, summary: summary) {
            Picker(selection: $state.game) {
                Text("All games", bundle: .module).tag(CardGame?.none)
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(verbatim: game.title).tag(Optional(game))
                }
            } label: {
                Text("Game", bundle: .module)
            }
            if state.game != .onePiece && !illustratorChoices.isEmpty {
                Menu {
                    ForEach(illustratorChoices, id: \.self) { name in
                        Toggle(isOn: illustratorBinding(name)) { Text(verbatim: name) }
                    }
                } label: {
                    Text("Illustrators", bundle: .module)
                }
            }
            TCGSetFilterSection(
                availableSetNames: state.setChoices(availableSets),
                selection: $state.setNames,
                presentation: .submenu
            )
        }
    }

    private var illustratorChoices: [String] {
        state.illustratorChoices(availableIllustrators)
    }

    private var gameTitle: Text {
        guard let game = state.game else { return Text("All games", bundle: .module) }
        return Text(verbatim: game.title)
    }

    private var summary: Text {
        let sets = TCGSetFilterSection.summary(for: state.setNames)
        guard !state.illustrators.isEmpty else { return sets }
        return Text("\(sets) · \(state.illustrators.sorted().joined(separator: ", "))", bundle: .module)
    }

    private func illustratorBinding(_ name: String) -> Binding<Bool> {
        Binding(
            get: { state.illustrators.contains(name) },
            set: { selected in
                if selected {
                    state.illustrators.insert(name)
                } else {
                    state.illustrators.remove(name)
                }
            }
        )
    }
}
