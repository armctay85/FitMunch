import Foundation
import StoreKit
#if DEBUG
import StoreKitTest

/// Opens FitMunchProducts.storekit for the onboarding plan price.
///
/// SKTestSession talks to storekitd synchronously and can call back to the
/// main thread. The previous loader held that call inside a continuation the
/// main actor was waiting on, so opening the plan step deadlocked: 440 never
/// published "Choose Your Plan", and 375 lost the test runner. The session
/// now starts only after this function has left the main thread, and the
/// lock is not held across the storekitd call.
enum LocalStoreKitCatalog {
    private static let lock = NSLock()
    private static var session: SKTestSession?
    private static var didStart = false

    static func startIfRequested() async {
        guard AuditLaunch.isOnboarding else { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + .milliseconds(200)) {
                openCatalog()
                continuation.resume()
            }
        }
    }

    private static func openCatalog() {
        lock.lock()
        if didStart {
            lock.unlock()
            return
        }
        didStart = true
        lock.unlock()

        guard let url = Bundle.main.url(forResource: "FitMunchProducts", withExtension: "storekit") else {
            print("LOCAL_STOREKIT missing FitMunchProducts.storekit")
            return
        }
        do {
            let created = try SKTestSession(contentsOf: url)
            created.disableDialogs = true
            created.resetToDefaultState()
            lock.lock()
            session = created
            lock.unlock()
            print("LOCAL_STOREKIT started \(url.lastPathComponent)")
        } catch {
            print("LOCAL_STOREKIT failed \(error)")
        }
    }
}
#endif

/// StoreKit monthly price for the plan card. Not isolated to the main actor,
/// so Product.products cannot stall the plan frame.
/// Internal: OnboardingViewModel reads the price, period, and trial.
internal struct MonthlyOffer: Sendable {
    var price: String
    var period: String
    var trial: String
}

/// Internal: OnboardingViewModel.loadPremiumPrice calls load() from another file.
internal enum MonthlyOfferLoader {
    static func load() async -> MonthlyOffer? {
        #if DEBUG
        await LocalStoreKitCatalog.startIfRequested()
        #endif
        do {
            let products = try await Product.products(for: [Constants.ProductIDs.monthly])
            guard let product = products.first else { return nil }
            var trial = ""
            if let offer = product.subscription?.introductoryOffer, offer.paymentMode == .freeTrial {
                trial = "\(introLength(offer)) free trial, then \(product.displayPrice) per month"
            }
            return MonthlyOffer(price: product.displayPrice, period: "per month", trial: trial)
        } catch {
            print("Onboarding monthly price failed: \(error)")
            return nil
        }
    }

    private static func introLength(_ offer: Product.SubscriptionOffer) -> String {
        let value = offer.period.value
        switch offer.period.unit {
        case .day: return value == 1 ? "1 day" : "\(value) days"
        case .week: return value == 1 ? "1 week" : "\(value) weeks"
        case .month: return value == 1 ? "1 month" : "\(value) months"
        case .year: return value == 1 ? "1 year" : "\(value) years"
        @unknown default: return "a"
        }
    }
}
