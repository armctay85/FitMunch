import Foundation

#if DEBUG
import StoreKitTest

/// Starts the AU catalog for `-UseLocalStoreKit` captures and tests.
/// Release builds do not compile this type and do not link StoreKitTest.
enum LocalStoreKitBootstrap {
    private static var session: SKTestSession?

    static func startIfRequested() {
        guard PaywallLaunchArgument.isLocalStoreKit else { return }
        guard session == nil else { return }
        guard let url = Bundle.main.url(forResource: "FitMunchProducts", withExtension: "storekit") else {
            print("Local StoreKit file missing from the app bundle")
            return
        }
        do {
            let created = try SKTestSession(contentsOf: url)
            created.disableDialogs = true
            created.resetToDefaultState()
            session = created
            print("Local StoreKit session started")
        } catch {
            print("Local StoreKit session failed: \(error)")
        }
    }
}
#endif
