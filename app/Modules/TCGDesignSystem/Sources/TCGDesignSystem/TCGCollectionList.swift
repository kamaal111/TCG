import SwiftUI

public struct TCGCollectionList<Controls: View, Rows: View, EmptyContent: View, Footer: View>: View {
    @Binding private var query: String
    private let title: Text
    private let hidesScrollBackground: Bool
    private let showsEmptyContent: Bool
    private let controls: Controls
    private let rows: Rows
    private let emptyContent: EmptyContent
    private let footer: Footer

    public init(
        title: Text,
        query: Binding<String>,
        hidesScrollBackground: Bool,
        showsEmptyContent: Bool,
        @ViewBuilder controls: () -> Controls,
        @ViewBuilder rows: () -> Rows,
        @ViewBuilder emptyContent: () -> EmptyContent,
        @ViewBuilder footer: () -> Footer
    ) {
        self.title = title
        _query = query
        self.hidesScrollBackground = hidesScrollBackground
        self.showsEmptyContent = showsEmptyContent
        self.controls = controls()
        self.rows = rows()
        self.emptyContent = emptyContent()
        self.footer = footer()
    }

    public var body: some View {
        TCGSearchKeyboardScope(query: $query, prompt: Text("Search cards", bundle: .module)) {
            list.navigationTitle(title)
        }
    }

    private var list: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    controls
                    if showsEmptyContent {
                        emptyContent.frame(maxWidth: .infinity, minHeight: 480)
                    } else {
                        rows
                    }
                    footer
                }
                .padding(24)
            }
        #else
            List {
                controls.listRowSeparator(.hidden)
                if showsEmptyContent {
                    emptyContent
                } else {
                    rows
                    footer.listRowSeparator(.hidden)
                }
            }
            .scrollContentBackground(hidesScrollBackground ? .hidden : .automatic)
        #endif
    }
}

public struct TCGCollectionNoMatches: View {
    public init() {}

    public var body: some View {
        ContentUnavailableView {
            Label {
                Text("No matching cards", bundle: .module)
            } icon: {
                Image(systemName: "line.3.horizontal.decrease")
            }
        } description: {
            Text("Change your filters to see more cards.", bundle: .module)
        }
    }
}

extension View {
    public func tcgCollectionListRow() -> some View {
        #if os(macOS)
            self
                .padding(12)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
        #else
            self
        #endif
    }
}

public struct TCGCollectionRowContent<Artwork: View, Details: View>: View {
    private let artwork: Artwork
    private let details: Details

    public init(@ViewBuilder artwork: () -> Artwork, @ViewBuilder details: () -> Details) {
        self.artwork = artwork()
        self.details = details()
    }

    public var body: some View {
        HStack(alignment: .top) {
            artwork
            details
        }
        .padding(.vertical, 4)
    }
}
