import SwiftUI
import TCGModels

public struct TCGGameFilter<Content: View>: View {
    @Binding private var selection: CardGame
    private let summary: Text?
    private let content: Content

    public init(selection: Binding<CardGame>, summary: Text?, @ViewBuilder content: () -> Content) {
        _selection = selection
        self.summary = summary
        self.content = content()
    }

    public var body: some View {
        TCGFilterMenu(gameTitle: Text(verbatim: selection.title), summary: summary) {
            Picker(selection: $selection) {
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(verbatim: game.title).tag(game)
                }
            } label: {
                Text("Game", bundle: .module)
            }
            content
        }
    }
}

extension TCGGameFilter where Content == EmptyView {
    public init(selection: Binding<CardGame>) {
        self.init(selection: selection, summary: nil) { EmptyView() }
    }
}
