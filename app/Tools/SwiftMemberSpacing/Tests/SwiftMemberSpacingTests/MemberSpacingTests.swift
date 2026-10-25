import Foundation
import Testing

@testable import SwiftMemberSpacing

struct MemberSpacingTests {
    @Test
    func `Rejects compact backup document`() {
        let source = """
            struct CollectionBackupDocument: FileDocument {
                static var readableContentTypes: [UTType] { [.json] }
                let data: Data
                init(data: Data) { self.data = data }
                init(configuration: ReadConfiguration) { data = configuration.file.regularFileContents ?? Data() }
                func fileWrapper(configuration: WriteConfiguration) -> FileWrapper {
                    FileWrapper(regularFileWithContents: data)
                }
            }
            """
        #expect(
            MemberSpacing.diagnostics(source: source, path: "Backup.swift") == [
                "Backup.swift:4:5: error: Separate initializers and methods from adjacent members with a blank line. [member_spacing]",
                "Backup.swift:5:5: error: Separate initializers and methods from adjacent members with a blank line. [member_spacing]",
                "Backup.swift:6:5: error: Separate initializers and methods from adjacent members with a blank line. [member_spacing]",
            ]
        )
    }

    @Test(arguments: [
        """
        struct Example {
            let first: Int
            let second: Int

            init() { first = 1; second = 2 }

            func read() -> Int { first }
        }
        """,
        """
        struct Example {
            func read() {}
        }
        """,
        """
        struct Example {
            let first = 1

            /// Reads the value.
            @MainActor
            func read() {}
        }
        """,
        """
        struct Example {
            let first = 1 // A trailing property comment.

            func read() {}
        }
        """,
        """
        struct Example {
            func read() {}

            let first = 1
        }
        """,
        "struct Example { let first = 1; let second = 2 }",
    ])
    func `Accepts separated methods and grouped properties`(source: String) {
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").isEmpty)
    }

    @Test(arguments: [
        """
        struct Example {
            let first = 1
            /// Reads the value.
            @MainActor
            func read() {}
        }
        """,
        """
        struct Example {
            let first = 1 // A trailing property comment.
            func read() {}
        }
        """,
        """
        struct Example {
            let first = 1
            /* A comment containing

               a blank line. */
            func read() {}
        }
        """,
        """
        struct Example {
            func read() {}
            let first = 1
        }
        """,
        """
        protocol Example {
            func first()
            func second()
        }
        """,
        """
        extension Example {
            func first() {}
            func second() {}
        }
        """,
        """
        struct Outer {
            struct Inner {
                init() {}
                func read() {}
            }
        }
        """,
        """
        struct Example {
            #if os(macOS)
                func first() {}
                func second() {}
            #else
                func third() {}

                func fourth() {}
            #endif
        }
        """,
    ])
    func `Rejects missing member separation`(source: String) {
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").count == 1)
    }

    @Test
    func `Ignores declarations inside strings and comments`() {
        let source = #"""
            struct Example {
                let source = """
                    func first() {}
                    func second() {}
                    """
                // func first() {}
                // func second() {}
                let another = 1
            }
            """#
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").isEmpty)
    }

    @Test
    func `Handles Windows line endings and whitespace only blank lines`() {
        let source = "struct Example {\r\n    let first = 1\r\n    \r\n    func read() {}\r\n}"
        #expect(MemberSpacing.diagnostics(source: source, path: "Example.swift").isEmpty)
    }

    @Test
    func `Rejects invalid Swift syntax`() {
        #expect(
            MemberSpacing.diagnostics(source: "struct Example {", path: "Broken.swift") == [
                "Broken.swift:1:1: error: Cannot check member spacing because Swift syntax is invalid."
            ]
        )
    }
}
