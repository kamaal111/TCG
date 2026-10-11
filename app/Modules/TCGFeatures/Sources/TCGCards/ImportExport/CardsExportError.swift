import Foundation
import TCGClient

public enum CardsExportError: LocalizedError, Equatable {
    case collection(CardBackupErrors)
    case fileWriteFailed

    public var errorDescription: String? {
        switch self {
        case .collection:
            String(
                localized:
                    "Your collection couldn’t be exported. Check your connection and signed-in account, then try again.",
                bundle: .module
            )
        case .fileWriteFailed:
            CardsCSVError.unwritable.errorDescription
        }
    }
}
