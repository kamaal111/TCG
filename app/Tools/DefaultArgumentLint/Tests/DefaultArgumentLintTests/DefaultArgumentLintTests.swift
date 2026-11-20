import Testing

@testable import DefaultArgumentLint

struct DefaultArgumentLintTests {
    @Test(arguments: [
        "func load(limit: Int = 10) {}",
        "struct Loader { init(limit: Int = 10) {} }",
        "struct Loader { subscript(limit: Int = 10) -> Int { limit } }",
        "enum Command { case load(limit: Int = 10) }",
        "func outer() { func load(limit: Int = 10) {} }",
        "#if os(Windows)\nfunc load(limit: Int = 10) {}\n#endif",
    ])
    func rejectsDefaultArguments(source: String) {
        let diagnostics = DefaultArgumentLint.diagnostics(in: source, file: "Example.swift")

        #expect(diagnostics.count == 1)
    }

    @Test func reportsTheLocationOfEachDefault() {
        let source = """
            func load(
                limit: Int = 10,
                offset: Int = 0
            ) {}
            """

        #expect(
            DefaultArgumentLint.diagnostics(in: source, file: "Example.swift") == [
                "Example.swift:2:16: error: Pass this argument explicitly. [no_default_arguments]",
                "Example.swift:3:17: error: Pass this argument explicitly. [no_default_arguments]",
            ]
        )
    }

    @Test func acceptsRequiredOptionalsAndStoredPropertyInitializers() {
        let source = """
            struct Loader {
                var limit = 10
                func load(limit: Int?) {}
            }
            """

        #expect(DefaultArgumentLint.diagnostics(in: source, file: "Example.swift").isEmpty)
    }
}
