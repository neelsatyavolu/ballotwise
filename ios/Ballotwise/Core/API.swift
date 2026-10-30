import Foundation

nonisolated enum APIError: LocalizedError, Sendable {
    case server(String)
    case signInNeeded(String)
    case offline
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .server(let m), .signInNeeded(let m): m
        case .offline: "You're offline. Results will update when you're back online."
        case .decoding: "The app got an answer it couldn't read. Try updating Ballotwise."
        }
    }
}

/// Talks to the same API the website uses. The account session is the website's `bw_session` cookie, kept in the
/// shared cookie store so it survives relaunches.
nonisolated final class API: Sendable {
    static let shared = API()
    static let base = URL(string: "https://ballotwise.xanom.co")!

    private let session: URLSession
    private let decoder = JSONDecoder()

    init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 30
        // ETags are handled by hand for live results; everything else may use the server's cache headers.
        config.requestCachePolicy = .useProtocolCachePolicy
        session = URLSession(configuration: config)
    }

    func url(_ path: String) -> URL { URL(string: path, relativeTo: Self.base)!.absoluteURL }

    func get<T: Decodable & Sendable>(_ path: String, as: T.Type = T.self) async throws -> T {
        try await send(URLRequest(url: url(path)), as: T.self)
    }

    /// A GET with If-None-Match: returns nil when the server says nothing changed since `etag`.
    func getIfChanged<T: Decodable & Sendable>(_ path: String, etag: String?, as: T.Type = T.self) async throws -> (T, String?)? {
        var req = URLRequest(url: url(path))
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await load(req)
        if response.statusCode == 304 { return nil }
        try check(data, response)
        return (try decode(T.self, data), response.value(forHTTPHeaderField: "ETag"))
    }

    func send<T: Decodable & Sendable>(_ method: String, _ path: String, body: some Encodable & Sendable, as: T.Type = T.self) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        return try await send(req, as: T.self)
    }

    private func send<T: Decodable & Sendable>(_ req: URLRequest, as: T.Type) async throws -> T {
        let (data, response) = try await load(req)
        try check(data, response)
        return try decode(T.self, data)
    }

    private func load(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw APIError.server("No response.") }
            return (data, http)
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code) {
            throw APIError.offline
        }
    }

    private func check(_ data: Data, _ response: HTTPURLResponse) throws {
        guard !(200..<300).contains(response.statusCode) else { return }
        let message = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "Something went wrong (\(response.statusCode)). Try again."
        throw response.statusCode == 401 ? APIError.signInNeeded(message) : APIError.server(message)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try decoder.decode(T.self, from: data) } catch { throw APIError.decoding(String(describing: error)) }
    }

    func signOutLocally() {
        HTTPCookieStorage.shared.cookies(for: Self.base)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    }
}

nonisolated private struct ErrorBody: Decodable { let error: String }
nonisolated struct OK: Decodable, Sendable { var ok: Bool? }
nonisolated struct Empty: Encodable, Sendable {}
