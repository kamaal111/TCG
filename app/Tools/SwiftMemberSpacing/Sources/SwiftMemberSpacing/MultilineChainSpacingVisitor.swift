import SwiftSyntax

final class MultilineChainSpacingVisitor: SyntaxVisitor {
    private(set) var violations: [SpacingViolation] = []
    private let converter: SourceLocationConverter

    init(converter: SourceLocationConverter) {
        self.converter = converter
        super.init(viewMode: .sourceAccurate)
    }

    override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
        if let member = node.parent?.as(MemberAccessExprSyntax.self),
            member.parent?.is(FunctionCallExprSyntax.self) == true
        {
            return .visitChildren
        }
        let startLine = converter.location(for: node.positionAfterSkippingLeadingTrivia).line
        let endLine = converter.location(for: node.endPositionBeforeTrailingTrivia).line
        guard startLine != endLine else { return .visitChildren }
        var call = node
        while let member = call.calledExpression.as(MemberAccessExprSyntax.self),
            let previous = member.base?.as(FunctionCallExprSyntax.self)
        {
            let previousLine = converter.location(for: previous.endPositionBeforeTrailingTrivia).line
            let dotPosition = member.period.positionAfterSkippingLeadingTrivia
            let dotLine = converter.location(for: dotPosition).line
            if previousLine == dotLine {
                violations.append(SpacingViolation(position: dotPosition, rule: .multilineChainSpacing))
            }
            call = previous
        }
        return .visitChildren
    }
}
