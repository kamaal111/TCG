import SwiftUI
import UniformTypeIdentifiers

struct CollectionBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) { data = configuration.file.regularFileContents ?? Data() }

    func fileWrapper(configuration: WriteConfiguration) -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
