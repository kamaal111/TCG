import SwiftSyntax

struct SpacingViolation {
    let position: AbsolutePosition
    let rule: SpacingRule
}

enum SpacingRule: String {
    case memberSpacing = "member_spacing"
    case multilineChainSpacing = "multiline_chain_spacing"
    case viewBodyDeclarations = "view_body_declarations"

    var message: String {
        switch self {
        case .memberSpacing:
            "Separate initializers and methods from adjacent members with a blank line."
        case .multilineChainSpacing:
            "Place each chained call on its own line in a multiline expression."
        case .viewBodyDeclarations:
            "Move local declarations out of SwiftUI body into computed properties or helper functions."
        }
    }
}
