import Foundation

struct MemberSpacingReport {
    let diagnostics: [String]

    var status: Int32 { diagnostics.isEmpty ? 0 : 1 }
}

enum MemberSpacingCommand {
    static func run(paths: [String]) -> MemberSpacingReport {
        guard !paths.isEmpty else {
            return MemberSpacingReport(diagnostics: ["error: Usage: swift-member-spacing <file-or-directory> ..."])
        }
        var diagnostics: [String] = []
        for path in paths {
            do {
                for file in try swiftFiles(at: URL(fileURLWithPath: path)) {
                    let source = try String(contentsOf: file, encoding: .utf8)
                    diagnostics += MemberSpacing.diagnostics(source: source, path: file.path)
                }
            } catch {
                diagnostics.append("\(path):1:1: error: Cannot check member spacing: \(error.localizedDescription)")
            }
        }
        return MemberSpacingReport(diagnostics: diagnostics)
    }

    private static func swiftFiles(at url: URL) throws -> [URL] {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        if values.isSymbolicLink == true { return [] }
        guard values.isDirectory == true else {
            return url.pathExtension == "swift" ? [url] : []
        }
        let children = try FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        )
        return try children.sorted { $0.path < $1.path }.flatMap { try swiftFiles(at: $0) }
    }
}
