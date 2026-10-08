import Foundation

public enum TCGLocales {
    /// Keeps machine-readable decimal amounts independent of the user's region.
    public static let decimal = Locale(identifier: "en_US_POSIX")
    public static let snapshot = Locale(identifier: "en_US")
    public static var current: Locale { .current }
}
