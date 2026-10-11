import SwiftUI
import UniformTypeIdentifiers

public struct CSVFileDocument: FileDocument {
    public static let readableContentTypes: [UTType] = [.commaSeparatedText]
    private let data: Data

    public init(temporaryURL: URL) throws {
        defer { try? FileManager.default.removeItem(at: temporaryURL) }
        data = try Data(contentsOf: temporaryURL)
    }

    public init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
    }

    public func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
