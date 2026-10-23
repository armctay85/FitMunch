#if DEBUG
import Foundation
import StoreKitTest

/// Opens FitMunchProducts.storekit in this process for the onboarding plan price.
/// `SKTestSession(contentsOf:)` and `resetToDefaultState()` talk to storekitd
/// synchronously. Doing that on the main actor blocks the first frame, so XCTest
/// never sees Welcome. The work runs off the main thread, and only when the
/// plan step asks for a price.
enum LocalStoreKitCatalog {
    private static let lock = NSLock()
    private static var session: SKTestSession?
    private static var didStart = false

    static func startIfRequested() async {
        guard AuditLaunch.isOnboarding else { return }
        lock.lock()
        let already = didStart
        lock.unlock()
        guard !already else { return }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                lock.lock()
                defer {
                    lock.unlock()
                    continuation.resume()
                }
                guard !didStart else { return }
                didStart = true
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
    }
}
#endif
