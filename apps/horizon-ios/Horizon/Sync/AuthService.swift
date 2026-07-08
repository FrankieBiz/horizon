import Foundation
import AuthenticationServices

/// Sign in with Apple → Supabase Auth token exchange.
/// Tokens live in the Keychain, never UserDefaults.
@MainActor
final class AuthService {

    static let supabaseURL = URL(string: "https://ejhomaidmvrdovvuvqya.supabase.co")!
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqaG9tYWlkbXZyZG92dnV2cXlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MDQ3MzEsImV4cCI6MjA5OTA4MDczMX0.aT_OTJMrqeras44v2rqca7i-P7nGhtpoIUC4R229N-s" // anon key — safe in client

    private(set) var accessToken: String?
    private(set) var userID: String?

    struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int
        let user: UserInfo
        struct UserInfo: Decodable { let id: String }
    }

    /// Exchange a Sign-in-with-Apple identity token for a Supabase session.
    func signIn(withAppleIDToken idToken: String) async throws {
        var request = URLRequest(url: Self.supabaseURL
            .appending(path: "/auth/v1/token")
            .appending(queryItems: [URLQueryItem(name: "grant_type", value: "id_token")]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "provider": "apple",
            "id_token": idToken,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw ApiError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 0,
                                     String(data: data, encoding: .utf8) ?? "")
        }
        let tokens = try JSONDecoder().decode(TokenResponse.self, from: data)
        try Keychain.set(tokens.access_token, for: "horizon.accessToken")
        try Keychain.set(tokens.refresh_token, for: "horizon.refreshToken")
        accessToken = tokens.access_token
        userID = tokens.user.id
    }

    /// Restore a session at launch; refresh if we have a refresh token.
    func restoreSession() async -> Bool {
        guard let refresh = Keychain.get("horizon.refreshToken") else { return false }
        do {
            var request = URLRequest(url: Self.supabaseURL
                .appending(path: "/auth/v1/token")
                .appending(queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")]))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(Self.supabaseAnonKey, forHTTPHeaderField: "apikey")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            let tokens = try JSONDecoder().decode(TokenResponse.self, from: data)
            try Keychain.set(tokens.access_token, for: "horizon.accessToken")
            try Keychain.set(tokens.refresh_token, for: "horizon.refreshToken")
            accessToken = tokens.access_token
            userID = tokens.user.id
            return true
        } catch {
            return false
        }
    }

    func signOut() {
        Keychain.delete("horizon.accessToken")
        Keychain.delete("horizon.refreshToken")
        accessToken = nil
        userID = nil
    }
}

// MARK: - Minimal Keychain wrapper

enum Keychain {
    static func set(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
