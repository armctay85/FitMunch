import Foundation
import Security

/// Minimal Keychain wrapper for the FitMunch session token.
enum KeychainStore {
    private static let service = "au.com.fitmunch.ios"
    private static let tokenAccount = "fm_token"

    static var token: String? {
        get { read(account: tokenAccount) }
        set {
            if let value = newValue { write(account: tokenAccount, value: value) }
            else { delete(account: tokenAccount) }
        }
    }

    private static func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read(account: String) -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func write(account: String, value: String) {
        let data = Data(value.utf8)
        var query = baseQuery(account: account)
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess {
            SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        } else {
            query[kSecValueData as String] = data
            SecItemAdd(query as CFDictionary, nil)
        }
    }

    private static func delete(account: String) {
        SecItemDelete(baseQuery(account: account) as CFDictionary)
    }
}
