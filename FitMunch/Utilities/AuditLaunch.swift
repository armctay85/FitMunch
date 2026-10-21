import Foundation

/// Debug-only launch hooks for capture. Release builds ignore every flag.
enum AuditLaunch {
    static let offline = "-AuditOffline"
    static let consentDenied = "-AuditConsentDenied"

    static var isOffline: Bool { flag(offline) }
    static var isConsentDenied: Bool { flag(consentDenied) }

    private static func flag(_ name: String) -> Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(name)
        #else
        return false
        #endif
    }
}
