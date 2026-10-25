import SwiftSyntax

final class ViewBodyDeclarationVisitor: SyntaxVisitor {
    private(set) var violations: [SpacingViolation] = []

    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        guard node.parent?.is(MemberBlockItemSyntax.self) == true else { return .visitChildren }
        for binding in node.bindings {
            guard binding.pattern.as(IdentifierPatternSyntax.self)?.identifier.text == "body",
                let type = binding.typeAnnotation?.type.as(SomeOrAnyTypeSyntax.self),
                type.someOrAnySpecifier.tokenKind == .keyword(.some),
                ["View", "SwiftUI.View"].contains(type.constraint.trimmedDescription),
                let accessors = binding.accessorBlock
            else { continue }
            let locals = BodyLocalDeclarationVisitor(viewMode: .sourceAccurate)
            locals.walk(accessors)
            violations += locals.violations
        }
        return .visitChildren
    }
}

private final class BodyLocalDeclarationVisitor: SyntaxVisitor {
    private(set) var violations: [SpacingViolation] = []

    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        guard node.parent?.is(MemberBlockItemSyntax.self) != true else { return .skipChildren }
        violations.append(
            SpacingViolation(
                position: node.bindingSpecifier.positionAfterSkippingLeadingTrivia,
                rule: .viewBodyDeclarations
            )
        )
        return .visitChildren
    }
}
