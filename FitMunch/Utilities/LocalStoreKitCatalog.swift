#if DEBUG
import Foundation
import StoreKitTest

/// Opens FitMunchProducts.storekit in this process for the onboarding width shot.
/// The scheme's StoreKit file is not applied on Xcode 26, and a session in the
/// UI test process does not change the app's Product.products. Held for the
/// launch so displayPrice stays on the file (AUS, 19.99) instead of US 12.99.
enum LocalStoreKitCatalog {
    private static var session: SKTestSession?

    static func startIfRequested() {
        guard AuditLaunch.isOnboarding, session == nil else { return }
        guard let url = Bundle.main.url(forResource: "FitMunchProducts", withExtension: "storekit") else {
            print("LOCAL_STOREKIT missing FitMunchProducts.storekit")
            return
        }
        do {
            let created = try SKTestSession(contentsOf: url)
            created.disableDialogs = true
            created.resetToDefaultState()
            session = created
            print("LOCAL_STOREKIT started \(url.lastPathComponent)")
        } catch {
            print("LOCAL_STOREKIT failed \(error)")
        }
    }
}
#endif
