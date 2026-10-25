import Foundation
import StoreKit

/// StoreKit monthly price for the plan card. Not isolated to the main actor,
/// so Product.products cannot stall the plan frame.
/// Internal: OnboardingViewModel reads the price, period, and trial.
///
/// The price comes from the scheme StoreKit configuration
/// (FitMunchProducts.storekit, Australia). The card stays on "See plans"
/// until displayPrice returns.
internal struct MonthlyOffer: Sendable {
    var price: String
    var period: String
    var trial: String
}

/// Internal: OnboardingViewModel.loadPremiumPrice calls load() from another file.
internal enum MonthlyOfferLoader {
    static func load() async -> MonthlyOffer? {
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
