import Foundation

struct ServerConfiguration: Sendable {
    let url: URL
    let origin: String

    init(baseURL: String?, environment: String?) throws(Failure) {
        let sourceURL: String?
        if baseURL == nil, environment == nil {
            do {
                sourceURL = try Servers.Server1.url().absoluteString
            } catch {
                throw .invalidURL
            }
        } else {
            guard environment == "remote" || environment == "local" else { throw .invalidEnvironment }
            sourceURL = baseURL
        }

        guard let baseURL = sourceURL else { throw .missingURL }
        guard baseURL == baseURL.trimmingCharacters(in: .whitespacesAndNewlines) else { throw .invalidURL }
        guard !baseURL.contains("$(") else { throw .invalidURL }
        guard var components = URLComponents(string: baseURL) else { throw .invalidURL }
        guard let scheme = components.scheme?.lowercased() else { throw .invalidURL }
        guard scheme == "https" || (environment != "remote" && scheme == "http") else { throw .invalidURL }
        guard let host = components.host?.lowercased() else { throw .invalidURL }
        guard Self.isValidHost(host) else { throw .invalidURL }
        guard components.user == nil else { throw .invalidURL }
        guard components.password == nil else { throw .invalidURL }
        guard components.query == nil else { throw .invalidURL }
        guard components.fragment == nil else { throw .invalidURL }
        guard components.path.isEmpty || components.path == "/" else { throw .invalidURL }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port ?? defaultPort
        guard (1...65535).contains(port) else { throw .invalidURL }
        components.scheme = scheme
        components.host = host
        components.port = port == defaultPort ? nil : port
        guard let url = components.url else { throw .invalidURL }
        self.url = url
        self.origin = "\(scheme)://\(host):\(port)"
    }

    private static func isValidHost(_ host: String) -> Bool {
        guard host.count <= 253 else { return false }
        return
            host
            .split(separator: ".", omittingEmptySubsequences: false)
            .allSatisfy { label in
                guard (1...63).contains(label.count) else { return false }
                guard label.first != "-" else { return false }
                guard label.last != "-" else { return false }
                return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
            }
    }

    enum Failure: Error, Equatable, CustomStringConvertible {
        case missingURL
        case invalidURL
        case invalidEnvironment

        var description: String {
            switch self {
            case .missingURL:
                "The app server URL is missing. Configure Remote.local.xcconfig or select TCG Local."
            case .invalidURL:
                "The app server URL is invalid. Use an API hostname without a scheme, path, or credentials; remote builds require HTTPS."
            case .invalidEnvironment:
                "The app environment is invalid. Select the TCG or TCG Local configuration."
            }
        }
    }
}
