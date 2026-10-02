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

enum PaywallPeriodUnit: String, Equatable {
    case day, week, month, year
}

/// Introductory offer terms copied off StoreKit. Views format copy from this.
struct PaywallIntroOffer: Equatable {
    var periodUnit: PaywallPeriodUnit
    var periodValue: Int
    var isFreeTrial: Bool
}

/// Price and trial copy built from StoreKit amounts. No hard-coded charges.
enum PaywallPricing {
    struct CTA: Equatable {
        var title: String
        var subline: String?
    }

    struct TrialTimeline: Equatable {
        var today: String
        var remind: String
        var billed: String
    }

    static func perWeekAmount(annual: Decimal) -> Decimal {
        annual / Decimal(52)
    }

    /// Percent saved versus paying the monthly price twelve times. Nil when the
    /// annual price is not actually cheaper.
    static func savingsPercent(monthly: Decimal, annual: Decimal) -> Int? {
        guard monthly > 0, annual > 0 else { return nil }
        let yearAtMonthly = monthly * Decimal(12)
        guard yearAtMonthly > annual else { return nil }
        let saved = (yearAtMonthly - annual) / yearAtMonthly
        let percent = NSDecimalNumber(decimal: saved * 100).doubleValue
        let rounded = Int(percent.rounded())
        guard rounded > 0 else { return nil }
        return rounded
    }

    static func format(amount: Decimal, currencyCode: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        if currencyCode == "AUD" {
            formatter.locale = Locale(identifier: "en_AU")
        }
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: amount as NSDecimalNumber)
            ?? NSDecimalNumber(decimal: amount).stringValue
    }

    static func perWeekLabel(annual: Decimal, currencyCode: String) -> String? {
        guard annual > 0 else { return nil }
        return "\(format(amount: perWeekAmount(annual: annual), currencyCode: currencyCode))/wk"
    }

    static func billingPeriodWord(_ unit: PaywallPeriodUnit) -> String {
        switch unit {
        case .day: return "day"
        case .week: return "week"
        case .month: return "month"
        case .year: return "year"
        }
    }

    static func introLengthLabel(_ intro: PaywallIntroOffer) -> String {
        "\(intro.periodValue)-\(billingPeriodWord(intro.periodUnit))"
    }

    static func introDays(_ intro: PaywallIntroOffer) -> Int {
        switch intro.periodUnit {
        case .day: return intro.periodValue
        case .week: return intro.periodValue * 7
        case .month: return intro.periodValue * 30
        case .year: return intro.periodValue * 365
        }
    }

    /// Trial button only when StoreKit has a free intro and the account is eligible.
    static func cta(
        displayPrice: String,
        periodUnit: PaywallPeriodUnit,
        intro: PaywallIntroOffer?,
        eligible: Bool
    ) -> CTA {
        let period = billingPeriodWord(periodUnit)
        if let intro, intro.isFreeTrial, eligible {
            return CTA(
                title: "Start \(introLengthLabel(intro)) free trial",
                subline: "then \(displayPrice)/\(period) · cancel anytime"
            )
        }
        return CTA(title: "Subscribe for \(displayPrice)/\(period)", subline: nil)
    }

    /// Day 12 / Day 14 when the intro is 14 days. Hidden unless that offer exists.
    static func trialTimeline(intro: PaywallIntroOffer?, eligible: Bool) -> TrialTimeline? {
        guard eligible, let intro, intro.isFreeTrial else { return nil }
        let days = introDays(intro)
        guard days >= 2 else { return nil }
        return TrialTimeline(
            today: "Today full access",
            remind: "Day \(days - 2) we remind you",
            billed: "Day \(days) billed"
        )
    }
}

/// Value type the paywall renders. Views never touch raw RevenueCat packages.
struct PaywallPlan: Identifiable, Equatable {
    let id: String
    let title: String
    let description: String
    let priceString: String
    var amount: Decimal = 0
    var currencyCode: String = "AUD"
    var periodUnit: PaywallPeriodUnit = .month
    var periodValue: Int = 1
    var intro: PaywallIntroOffer? = nil
    var eligibleForIntro: Bool = false

    static func == (lhs: PaywallPlan, rhs: PaywallPlan) -> Bool {
        lhs.id == rhs.id
    }
}
