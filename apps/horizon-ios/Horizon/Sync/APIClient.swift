import Foundation

enum ApiError: Error {
    case notAuthenticated
    case badStatus(Int, String)
    case decoding(Error)
    case transport(Error)
}

/// Thin URLSession wrapper (house pattern): generic verbs, typed errors,
/// centralized auth header, snake_case + ISO-8601 wire format.
final class APIClient: Sendable {

    static let baseURL: URL = {
        #if DEBUG
        URL(string: "http://localhost:3000")!
        #else
        URL(string: "https://horizon-api.onrender.com")!
        #endif
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    func post<Body: Encodable, Response: Decodable>(
        _ path: String, body: Body, token: String?
    ) async throws -> Response {
        try await send(path: path, method: "POST", body: body, token: token)
    }

    func put<Body: Encodable, Response: Decodable>(
        _ path: String, body: Body, token: String?
    ) async throws -> Response {
        try await send(path: path, method: "PUT", body: body, token: token)
    }

    func get<Response: Decodable>(_ path: String, token: String?) async throws -> Response {
        try await send(path: path, method: "GET", body: Optional<Int>.none, token: token)
    }

    func delete(_ path: String, token: String?) async throws {
        let _: EmptyResponse = try await send(
            path: path, method: "DELETE", body: Optional<Int>.none, token: token)
    }

    struct EmptyResponse: Decodable {}

    private func send<Body: Encodable, Response: Decodable>(
        path: String, method: String, body: Body?, token: String?
    ) async throws -> Response {
        guard let token else { throw ApiError.notAuthenticated }
        var request = URLRequest(url: Self.baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try encoder.encode(body) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError.transport(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw ApiError.badStatus(status, String(data: data, encoding: .utf8) ?? "")
        }
        if Response.self == EmptyResponse.self, data.isEmpty {
            return EmptyResponse() as! Response
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw ApiError.decoding(error)
        }
    }
}
