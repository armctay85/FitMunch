import Foundation

/// Pure filters for App Store subscription products. No RevenueCat types so
/// empty offerings and unknown IDs cannot crash UI.
enum PaywallCatalog {
    static let monthly = Constants.ProductIDs.monthly
    static let annual = Constants.ProductIDs.annual
    static let sellable = Constants.ProductIDs.sellable

    /// Display title when StoreKit localizedTitle is empty.
    static func fallbackTitle(productId: String) -> String {
        switch productId {
        case monthly: return "Monthly Premium"
        case annual: return "Annual Premium"
        default: return "Premium"
        }
    }

    static func fallbackDescription(productId: String) -> String {
        switch productId {
        case monthly: return "Billed every month"
        case annual: return "Billed once a year"
        default: return "FitMunch Premium"
        }
    }

    /// Keep monthly and annual, in that order. Any other ID, including a legacy weekly ID, stays out.
    static func selectSellableIds(from productIds: [String]) -> [String] {
        var seen = Set<String>()
        var selected: [String] = []
        for id in sellable {
            guard productIds.contains(id), !seen.contains(id) else { continue }
            seen.insert(id)
            selected.append(id)
        }
        return selected
    }

    static func displayTitle(productId: String, storeTitle: String) -> String {
        let trimmed = storeTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallbackTitle(productId: productId) : trimmed
    }

    static func displayDescription(productId: String, storeDescription: String) -> String {
        let trimmed = storeDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallbackDescription(productId: productId) : trimmed
    }
}

/// How the paywall decides between loading, plans, and the retry error.
/// One automatic retry with backoff happens before the error is allowed on screen.
enum PaywallLoadPolicy {
    static let automaticRetryBackoffNanoseconds: UInt64 = 1_500_000_000
    static let maxAutomaticAttempts = 2
    static let userFacingLoadFailure = "Plans couldn't load. Check your connection and try again."

    enum Phase: Equatable {
        case loading
        case ready
        case failed
    }

    static func phase(attempt: Int, hasPlans: Bool) -> Phase {
        if hasPlans { return .ready }
        if attempt < maxAutomaticAttempts { return .loading }
        return .failed
    }
}

enum PaywallLaunchArgument {
    static let forceEmpty = "-PaywallForceEmpty"
    static let localStoreKit = "-UseLocalStoreKit"
    static let sandboxProbe = "-SandboxProductProbe"
}

/// Value type the paywall renders. Views never touch raw RevenueCat packages.
struct PaywallPlan: Identifiable, Equatable {
    let id: String
    let title: String
    let description: String
    let priceString: String

    static func == (lhs: PaywallPlan, rhs: PaywallPlan) -> Bool {
        lhs.id == rhs.id
    }
}
