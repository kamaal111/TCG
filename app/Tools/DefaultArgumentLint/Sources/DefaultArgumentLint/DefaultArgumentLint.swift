import Foundation
import SwiftParser
import SwiftSyntax

@main
enum DefaultArgumentLint {
    static func main() {
        let paths = CommandLine.arguments.dropFirst()
        guard !paths.isEmpty else {
            writeError("Usage: DefaultArgumentLint <file-or-directory> ...")
            exit(2)
        }

        var failed = false
        for path in paths {
            do {
                let files = try swiftFiles(at: URL(filePath: path))
                for diagnostic in files.flatMap(diagnostics(in:)) {
                    writeError(diagnostic)
                    failed = true
                }
            } catch {
                writeError("\(path):1:1: error: Cannot list Swift sources: \(error.localizedDescription)")
                failed = true
            }
        }
        exit(failed ? 1 : 0)
    }

    private static func diagnostics(in file: URL) -> [String] {
        do {
            let source = try String(contentsOf: file, encoding: .utf8)
            return diagnostics(in: source, file: file.path)
        } catch {
            return ["\(file.path):1:1: error: Cannot read Swift source: \(error.localizedDescription)"]
        }
    }

    static func diagnostics(in source: String, file: String) -> [String] {
        let tree = Parser.parse(source: source)
        let visitor = DefaultArgumentVisitor(viewMode: .sourceAccurate)
        visitor.walk(tree)

        let locations = SourceLocationConverter(fileName: file, tree: tree)
        return visitor.positions.map { position in
            let location = locations.location(for: position)
            return
                "\(file):\(location.line):\(location.column): error: Pass this argument explicitly. [no_default_arguments]"
        }
    }

    private static func swiftFiles(at url: URL) throws -> [URL] {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey]
        let values = try url.resourceValues(forKeys: keys)
        guard values.isSymbolicLink != true else { return [] }
        guard values.isDirectory == true else { return url.pathExtension == "swift" ? [url] : [] }
        guard url.lastPathComponent != "node_modules" else { return [] }

        let children = try FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )
        return try children.sorted { $0.path < $1.path }.flatMap { try swiftFiles(at: $0) }
    }

    private static func writeError(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}

private final class DefaultArgumentVisitor: SyntaxVisitor {
    private(set) var positions: [AbsolutePosition] = []

    override func visit(_ node: FunctionParameterSyntax) -> SyntaxVisitorContinueKind {
        if let value = node.defaultValue {
            positions.append(value.equal.positionAfterSkippingLeadingTrivia)
        }
        return .visitChildren
    }

    override func visit(_ node: EnumCaseParameterSyntax) -> SyntaxVisitorContinueKind {
        if let value = node.defaultValue {
            positions.append(value.equal.positionAfterSkippingLeadingTrivia)
        }
        return .visitChildren
    }
}
