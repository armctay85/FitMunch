import Foundation

#if DEBUG
import StoreKitTest

/// Installs FitMunchProducts.storekit in the app process after launch.
/// UI tests cannot do this from the runner. Release builds do not contain this type.
enum LocalStoreKitSession {
    private static let lock = NSLock()
    private static var session: SKTestSession?

    /// True when -UseLocalStoreKit is set and the catalog session is active.
    static func startIfRequested() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.localStoreKit) else {
            return false
        }
        if session != nil { return true }
        guard let url = Bundle.main.url(forResource: "FitMunchProducts", withExtension: "storekit") else {
            NSLog("STOREKIT_SESSION missing FitMunchProducts.storekit")
            return false
        }
        do {
            NSLog("STOREKIT_SESSION starting \(url.path)")
            let created = try SKTestSession(contentsOf: url)
            created.disableDialogs = false
            created.resetToDefaultState()
            session = created
            NSLog("STOREKIT_SESSION started \(url.path)")
            return true
        } catch {
            let ns = error as NSError
            NSLog("STOREKIT_SESSION failed \(ns.domain) Code=\(ns.code) \(ns.localizedDescription)")
            return false
        }
    }
}
#endif
