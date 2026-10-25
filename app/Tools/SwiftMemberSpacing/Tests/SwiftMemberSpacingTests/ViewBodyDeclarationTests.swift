import Testing

@testable import SwiftMemberSpacing

struct ViewBodyDeclarationTests {
    @Test
    func `Rejects local constants in body`() {
        let source = """
            struct Example: View {
                var body: some View {
                    let title = "Page"
                    Text(title)
                }
            }
            """
        #expect(
            MemberSpacing.diagnostics(source: source, path: "Example.swift") == [
                "Example.swift:3:9: error: Move local declarations out of SwiftUI body into computed properties or helper functions. [view_body_declarations]"
            ]
        )
    }

    @Test(arguments: [
        """
        struct Example: View {
            var body: some View {
                GeometryReader { geometry in
                    let width = geometry.size.width
                    Text("Page").frame(width: width)
                }
            }
        }
        """,
        """
        struct Example: View {
            var body: some View {
                var title = "Page"
                Text(title)
            }
        }
        """,
        """
        struct Example: View {
            var body: some SwiftUI.View {
                get {
                    let title = "Page"
                    Text(title)
                }
            }
        }
        """,
        """
        struct Example: View {
            var body: some View {
                #if os(macOS)
                    let title = "Page"
                    Text(title)
                #else
                    Text("Page")
                #endif
            }
        }
        """,
    ])
    func `Rejects local declarations in nested builders and explicit getters`(source: String) {
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").count == 1)
        #expect(
            MemberSpacing.diagnostics(source: source, path: "Example.swift").first?.contains("[view_body_declarations]")
                == true
        )
    }

    @Test(arguments: [
        """
        struct Example: View {
            let title = "Page"
            var body: some View { Text(title) }
        }
        """,
        """
        struct Example: View {
            var title: String { "Page" }
            var body: some View { Text(title) }
        }
        """,
        """
        struct Example: View {
            let title: String?
            var body: some View {
                if let title { Text(title) }
            }
        }
        """,
        """
        struct Example: View {
            let title: String?
            var body: some View {
                Button {
                    guard let title else { return }
                    print(title)
                } label: {
                    Text("Page")
                }
            }
        }
        """,
        """
        struct Example: View {
            var body: some View { content() }

            private func content() -> some View {
                let title = "Page"
                return Text(title)
            }
        }
        """,
        """
        struct Response {
            var body: String {
                let title = "Page"
                return title
            }
        }
        """,
    ])
    func `Accepts computed properties conditional bindings and helper locals`(source: String) {
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").isEmpty)
    }
}
