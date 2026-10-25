import SwiftParser
import SwiftSyntax

enum MemberSpacing {
    static func diagnostics(source: String, path: String) -> [String] {
        let tree = Parser.parse(source: source)
        guard !tree.hasError else {
            return ["\(path):1:1: error: Cannot check member spacing because Swift syntax is invalid."]
        }
        let visitor = MemberSpacingVisitor(viewMode: .sourceAccurate)
        visitor.walk(tree)
        let converter = SourceLocationConverter(fileName: path, tree: tree)
        let chains = MultilineChainSpacingVisitor(converter: converter)
        chains.walk(tree)
        let bodies = ViewBodyDeclarationVisitor(viewMode: .sourceAccurate)
        bodies.walk(tree)
        return (visitor.violations + chains.violations + bodies.violations).sorted { $0.position < $1.position }
            .map { violation in
                let location = converter.location(for: violation.position)
                return
                    "\(path):\(location.line):\(location.column): error: \(violation.rule.message) [\(violation.rule.rawValue)]"
            }
    }
}

private final class MemberSpacingVisitor: SyntaxVisitor {
    private(set) var violations: [SpacingViolation] = []

    override func visit(_ node: MemberBlockItemListSyntax) -> SyntaxVisitorContinueKind {
        for (previous, current) in zip(node, node.dropFirst()) {
            guard !previous.decl.is(IfConfigDeclSyntax.self), !current.decl.is(IfConfigDeclSyntax.self),
                Self.isMethod(previous.decl) || Self.isMethod(current.decl)
            else { continue }
            let trivia = previous.trailingTrivia + current.leadingTrivia
            if !Self.hasBlankLineBeforeDeclaration(trivia) {
                violations.append(
                    SpacingViolation(position: current.positionAfterSkippingLeadingTrivia, rule: .memberSpacing)
                )
            }
        }
        return .visitChildren
    }

    private static func isMethod(_ declaration: DeclSyntax) -> Bool {
        declaration.is(FunctionDeclSyntax.self) || declaration.is(InitializerDeclSyntax.self)
    }

    private static func hasBlankLineBeforeDeclaration(_ trivia: Trivia) -> Bool {
        var lineBreaks = 0
        for piece in trivia {
            switch piece {
            case .newlines(let count), .carriageReturns(let count), .carriageReturnLineFeeds(let count):
                lineBreaks += count
                if lineBreaks >= 2 { return true }
            case .spaces, .tabs:
                continue
            default:
                // A comment on its own line belongs to the following declaration.
                if lineBreaks > 0 { return false }
            }
        }
        return false
    }
}
