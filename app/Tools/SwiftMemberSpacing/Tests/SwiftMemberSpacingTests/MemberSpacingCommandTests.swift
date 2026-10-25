import Foundation
import Testing

@testable import SwiftMemberSpacing

struct MemberSpacingCommandTests {
    @Test
    func `Returns failure for missing arguments`() {
        let report = MemberSpacingCommand.run(paths: [])
        #expect(report.status == 1)
        #expect(report.diagnostics == ["error: Usage: swift-member-spacing <file-or-directory> ..."])
    }

    @Test
    func `Returns failure for unreadable input`() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("Missing.swift").path
        let report = MemberSpacingCommand.run(paths: [path])
        #expect(report.status == 1)
        #expect(report.diagnostics.count == 1)
        #expect(report.diagnostics.first?.hasPrefix("\(path):1:1: error: Cannot check member spacing:") == true)
    }

    @Test
    func `Recursively checks Swift sources and skips build artifacts`() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let nested = directory.appendingPathComponent("Sources")
        let build = directory.appendingPathComponent(".build")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: build, withIntermediateDirectories: true)
        let source = """
            struct Example {
                let first = 1
                func read() {}
            }
            """
        let file = nested.appendingPathComponent("Example.swift")
        try source.write(to: file, atomically: true, encoding: .utf8)
        try source.write(to: build.appendingPathComponent("Ignored.swift"), atomically: true, encoding: .utf8)
        try source.write(to: directory.appendingPathComponent("Ignored.txt"), atomically: true, encoding: .utf8)
        let report = MemberSpacingCommand.run(paths: [directory.path])
        #expect(report.status == 1)
        #expect(report.diagnostics.count == 1)
        #expect(
            report.diagnostics.first?.hasSuffix(
                "/Sources/Example.swift:3:5: error: Separate initializers and methods from adjacent members with a blank line. [member_spacing]"
            ) == true
        )
    }

    @Test
    func `Returns success for separated members`() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("Example.swift")
        let source = """
            struct Example {
                let first = 1

                func read() {}
            }
            """
        try source.write(to: file, atomically: true, encoding: .utf8)
        let report = MemberSpacingCommand.run(paths: [file.path])
        #expect(report.status == 0)
        #expect(report.diagnostics.isEmpty)
    }

    @Test
    func `Returns failure for invalid syntax`() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("Broken.swift")
        try "struct Example {".write(to: file, atomically: true, encoding: .utf8)
        let report = MemberSpacingCommand.run(paths: [file.path])
        #expect(report.status == 1)
        #expect(
            report.diagnostics == [
                "\(file.path):1:1: error: Cannot check member spacing because Swift syntax is invalid."
            ]
        )
    }

    private static func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test(arguments: [
        (source: "struct Example { func first() {}\nfunc second() {} }", status: Int32(1)),
        (source: "struct Example { func first() {}\n\nfunc second() {} }", status: Int32(0)),
    ])
    func `Executable reports lint exit status`(source: String, status: Int32) throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("Example.swift")
        try source.write(to: file, atomically: true, encoding: .utf8)
        let package = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let output = Pipe()
        let process = Process()
        process.executableURL = package.appendingPathComponent(".build/debug/swift-member-spacing")
        process.arguments = [file.path]
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == status)
        #expect(String(decoding: data, as: UTF8.self).contains("[member_spacing]") == (status == 1))
    }
}
