import Foundation

@main
private enum SwiftMemberSpacing {
    static func main() {
        let report = MemberSpacingCommand.run(paths: Array(CommandLine.arguments.dropFirst()))
        for diagnostic in report.diagnostics {
            print(diagnostic)
        }
        exit(report.status)
    }
}
