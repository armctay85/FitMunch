import Foundation

/// Pure filters for App Store subscription products. No RevenueCat types so
/// empty offerings, missing weekly metadata, and unknown IDs cannot crash UI.
enum PaywallCatalog {
    static let monthly = Constants.ProductIDs.monthly
    static let annual = Constants.ProductIDs.annual
    static let weekly = Constants.ProductIDs.weekly
    static let sellable = Constants.ProductIDs.sellable

    /// Display title when StoreKit localizedTitle is empty (MISSING_METADATA).
    static func fallbackTitle(productId: String) -> String {
        switch productId {
        case monthly: return "Monthly Premium"
        case annual: return "Annual Premium"
        case weekly: return "Weekly Premium"
        default: return "Premium"
        }
    }

    static func fallbackDescription(productId: String) -> String {
        switch productId {
        case monthly: return "Billed every month"
        case annual: return "Billed once a year"
        case weekly: return "Billed every week"
        default: return "FitMunch Premium"
        }
    }

    /// Weekly with no title is MISSING_METADATA and must not block the paywall.
    static func isWeeklyMissingMetadata(productId: String, title: String) -> Bool {
        productId == weekly && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Keep monthly and annual. Drop weekly when metadata is missing. Unknown IDs stay out.
    static func selectSellableIds(from productIds: [String], titles: [String: String] = [:]) -> [String] {
        var seen = Set<String>()
        var selected: [String] = []
        for id in sellable {
            guard productIds.contains(id), !seen.contains(id) else { continue }
            let title = titles[id] ?? ""
            if isWeeklyMissingMetadata(productId: id, title: title) { continue }
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
