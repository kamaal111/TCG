import SwiftUI

public struct TCGFilterMenu<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private let gameTitle: Text
    private let summary: Text?
    private let content: Content

    public init(gameTitle: Text, summary: Text? = nil, @ViewBuilder content: () -> Content) {
        self.gameTitle = gameTitle
        self.summary = summary
        self.content = content()
    }

    public var body: some View {
        Menu {
            content
        } label: {
            Group {
                if usesStackedLabel, let summary {
                    VStack(alignment: .leading, spacing: 6) {
                        Label {
                            gameTitle
                        } icon: {
                            Image(systemName: "line.3.horizontal.decrease")
                        }
                        summary
                    }
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "line.3.horizontal.decrease")
                        gameTitle
                        if let summary {
                            Text(verbatim: "·")
                            summary
                        }
                    }
                }
            }
            .font(.subheadline)
            .frame(minHeight: 44)
        }
        .accessibilityLabel(Text("Filters", bundle: .module))
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: Text {
        guard let summary else { return gameTitle }
        return gameTitle + Text(verbatim: ", ") + summary
    }

    private var usesStackedLabel: Bool {
        #if os(iOS)
            dynamicTypeSize.isAccessibilitySize
        #else
            false
        #endif
    }
}
