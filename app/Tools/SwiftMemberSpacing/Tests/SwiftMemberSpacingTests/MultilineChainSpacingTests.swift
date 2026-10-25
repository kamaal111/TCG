import Testing

@testable import SwiftMemberSpacing

struct MultilineChainSpacingTests {
    @Test
    func `Rejects touching modifiers after multiline Button`() {
        let source = """
            Button {
                index -= 1
            } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(index == 0).accessibilityLabel(Text("Previous page", bundle: .module))
            """
        #expect(
            MemberSpacing.diagnostics(source: source, path: "Navigation.swift") == [
                "Navigation.swift:6:22: error: Place each chained call on its own line in a multiline expression. [multiline_chain_spacing]"
            ]
        )
    }

    @Test(arguments: [
        """
        Button {
            index -= 1
        } label: {
            Image(systemName: "chevron.left")
        }
        .disabled(index == 0)
        .accessibilityLabel(Text("Previous page", bundle: .module))
        """,
        "Text(\"Page\").tag(index)",
        """
        Text("Page")
            .font(.body)
            .padding()
        """,
        #"""
        let source = """
            Text("Page")
                .font(.body).padding()
            """
        """#,
        """
        // Text("Page")
        //     .font(.body).padding()
        """,
    ])
    func `Accepts separated modifiers and compact single line expressions`(source: String) {
        #expect(MemberSpacing.diagnostics(source: source, path: "Navigation.swift").isEmpty)
    }

    @Test
    func `Checks every call when only the last call is multiline`() {
        let source = """
            Text("Page").font(.body).background(
                Color.red
            )
            """
        #expect(
            MemberSpacing.diagnostics(source: source, path: "Navigation.swift") == [
                "Navigation.swift:1:13: error: Place each chained call on its own line in a multiline expression. [multiline_chain_spacing]",
                "Navigation.swift:1:25: error: Place each chained call on its own line in a multiline expression. [multiline_chain_spacing]",
            ]
        )
    }
}
