import Foundation
#if DEBUG
import StoreKitTest
#endif

/// Starts the local StoreKit catalog inside the app process.
/// UI tests cannot do this from the runner. The session exists only in Debug,
/// and only when the test passed -UseLocalStoreKit.
enum LocalStoreKitSession {
    static func startIfRequested() {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.localStoreKit) else { return }
        guard session == nil else { return }
        guard let url = Bundle.main.url(forResource: "FitMunchProducts", withExtension: "storekit") else {
            NSLog("FitMunchProducts.storekit missing from the app bundle")
            return
        }
        do {
            let created = try SKTestSession(contentsOf: url)
            created.disableDialogs = false
            created.resetToDefaultState()
            session = created
            NSLog("SKTestSession started from the app bundle")
        } catch {
            NSLog("SKTestSession app start failed: \(error.localizedDescription)")
        }
        #endif
    }

    #if DEBUG
    private static var session: SKTestSession?
    #endif
}
