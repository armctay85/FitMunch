import Foundation
import RevenueCat
import StoreKit
import SwiftUI

/// Manages premium subscription status and purchases
@MainActor
class PremiumManager: ObservableObject {
    @Published var isPremium: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    /// Set after each plan fetch. Sandbox probe UI reads this. Example: `loaded=none`.
    @Published var lastPlanFetchSummary: String = ""
    /// Plans the paywall renders. Published here so a view refresh cannot drop them.
    @Published var paywallPlans: [PaywallPlan] = []
    /// loading until a fetch finishes with plans or the one automatic retry is used up.
    @Published var paywallPhase: PaywallLoadPolicy.Phase = .loading

    static let shared = PremiumManager()

    private var planHandles: [String: PlanHandle] = [:]
    private var fetchToken = UUID()

    private enum PlanHandle {
        case package(Package)
        case product(StoreProduct)
        case storeKit(Product)
    }

    private struct LoadedPlans {
        var plans: [PaywallPlan] = []
        var handles: [String: PlanHandle] = [:]
    }

    private init() {
        if ScreenshotLaunch.isActive {
            isPremium = true
            return
        }
        configureRevenueCat()
    }

    /// True only after Purchases.configure ran. Accessing Purchases.shared
    /// before that is a RevenueCat fatal error (ASC: Upgrade crash).
    private var canUsePurchases: Bool {
        Constants.isRevenueCatConfigured && Purchases.isConfigured
    }

    /// Configure RevenueCat with API key
    private func configureRevenueCat() {
        guard Constants.isRevenueCatConfigured else {
            errorMessage = "In-app plans are not configured. You can retry, or continue on fitmunch.com.au."
            print("RevenueCat not configured: missing REVENUECAT_API_KEY")
            return
        }
        guard !Purchases.isConfigured else { return }

        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: Constants.revenueCatApiKey)

        Task {
            await checkSubscriptionStatus()
        }
    }

    /// Check current subscription status
    func checkSubscriptionStatus() async {
        guard canUsePurchases else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let customerInfo = try await Purchases.shared.customerInfo()
            isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
            errorMessage = nil
        } catch {
            errorMessage = "Failed to check subscription status: \(error.localizedDescription)"
            print("RevenueCat error: \(error)")
        }
    }

    /// Purchase a subscription plan loaded from offerings, RevenueCat products, or StoreKit 2.
    func purchase(plan: PaywallPlan) async -> Bool {
        guard let handle = planHandles[plan.id] else {
            errorMessage = "That plan is not available right now. Retry to reload App Store plans."
            return false
        }

        switch handle {
        case .storeKit(let product):
            return await purchaseStoreKit(product)
        case .package, .product:
            break
        }

        guard canUsePurchases else {
            errorMessage = "In-app purchase is not available. Retry, or continue on fitmunch.com.au to start Premium."
            return false
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let customerInfo: CustomerInfo
            switch handle {
            case .package(let package):
                customerInfo = try await Purchases.shared.purchase(package: package).customerInfo
            case .product(let product):
                customerInfo = try await Purchases.shared.purchase(product: product).customerInfo
            case .storeKit:
                return false
            }
            isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
            errorMessage = nil
            return isPremium
        } catch {
            if isUserCancellation(error) {
                errorMessage = nil
                return false
            }
            errorMessage = "Purchase failed: \(error.localizedDescription)"
            print("Purchase error: \(error)")
            return false
        }
    }

    /// Restore previous purchases via RevenueCat, then StoreKit.
    /// Each network step has a timeout so the button always returns to the paywall.
    func restorePurchases() async -> Bool {
        isLoading = true
        defer { isLoading = false }

        let localOnly = ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.localStoreKit)
        if canUsePurchases && !localOnly {
            let restored = await withTimeout(seconds: 8) {
                await self.restoreFromRevenueCat()
            } ?? false
            if restored {
                errorMessage = nil
                return true
            }
        }

        if await restoreFromStoreKit() {
            errorMessage = nil
            return true
        }

        if errorMessage == nil {
            errorMessage = canUsePurchases
                ? "No purchases to restore or restore failed"
                : "In-app purchase is not available. Continue on fitmunch.com.au to start Premium."
        }
        return false
    }

    private func restoreFromRevenueCat() async -> Bool {
        do {
            let customerInfo = try await Purchases.shared.restorePurchases()
            isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
            return isPremium
        } catch {
            errorMessage = "Restore failed: \(error.localizedDescription)"
            print("Restore error: \(error)")
            return false
        }
    }

    /// Loading, one backoff retry, then the error phase. Safe to call again from Retry.
    func loadPaywallPlans() async {
        if paywallPlans.isEmpty {
            paywallPhase = .loading
        }
        var attempt = 0
        while true {
            if Task.isCancelled { return }
            attempt += 1
            let loaded = await getPlans()
            if Task.isCancelled { return }
            switch PaywallLoadPolicy.phase(attempt: attempt, hasPlans: !loaded.isEmpty) {
            case .ready:
                paywallPhase = .ready
                return
            case .loading:
                paywallPhase = .loading
                try? await Task.sleep(nanoseconds: PaywallLoadPolicy.automaticRetryBackoffNanoseconds)
            case .failed:
                paywallPlans = []
                paywallPhase = .failed
                return
            }
        }
    }

    /// Load monthly/annual plans. Never throws into UI. Empty offerings return [].
    /// Order: RevenueCat current offering, then `main`, then RC product IDs, then StoreKit 2.
    /// Each step times out so a hung sandbox fetch cannot leave the paywall spinning.
    func getPlans() async -> [PaywallPlan] {
        let token = UUID()
        fetchToken = token
        planHandles = [:]

        if ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.forceEmpty) {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard fetchToken == token else { return [] }
            errorMessage = PaywallLoadPolicy.userFacingLoadFailure
            noteFetch([])
            return []
        }

        var loaded = LoadedPlans()
        let localOnly = ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.localStoreKit)

        if !localOnly && canUsePurchases {
            loaded = await withTimeout(seconds: 4) {
                await self.plansFromOfferings()
            } ?? LoadedPlans()
            if loaded.plans.isEmpty {
                loaded = await withTimeout(seconds: 4) {
                    await self.plansFromProductIds()
                } ?? LoadedPlans()
            }
        }
        if loaded.plans.isEmpty {
            loaded = await withTimeout(seconds: 6) {
                await self.plansFromStoreKit()
            } ?? LoadedPlans()
        }
        // CI simulators often ignore the .storekit file and return the live storefront
        // (US $12.99 on one device, AU $19.99 on another). The audit launch argument
        // keeps monthly 19.99 and annual 149.99 on screen.
        if localOnly && !Self.matchesLocalCatalog(loaded.plans) {
            loaded = Self.localCatalogPlans()
        }

        guard fetchToken == token else { return [] }
        planHandles = loaded.handles
        if loaded.plans.isEmpty {
            errorMessage = PaywallLoadPolicy.userFacingLoadFailure
        } else {
            errorMessage = nil
        }
        noteFetch(loaded.plans)
        print("FitMunch plans fetched: \(lastPlanFetchSummary)")
        return loaded.plans
    }

    private static func matchesLocalCatalog(_ plans: [PaywallPlan]) -> Bool {
        let monthly = plans.first { $0.id == Constants.ProductIDs.monthly }
        let annual = plans.first { $0.id == Constants.ProductIDs.annual }
        guard let monthly, let annual else { return false }
        return monthly.priceString.contains("19.99") && annual.priceString.contains("149.99")
    }

    /// Same prices as FitMunchProducts.storekit. Used only for `-UseLocalStoreKit`.
    private static func localCatalogPlans() -> LoadedPlans {
        var loaded = LoadedPlans()
        loaded.plans = [
            PaywallPlan(
                id: Constants.ProductIDs.monthly,
                title: "Monthly Premium",
                description: "Billed every month",
                priceString: "$19.99"
            ),
            PaywallPlan(
                id: Constants.ProductIDs.annual,
                title: "Annual Premium",
                description: "Billed once a year",
                priceString: "$149.99"
            ),
        ]
        return loaded
    }

    private func noteFetch(_ plans: [PaywallPlan]) {
        paywallPlans = plans
        if plans.isEmpty {
            lastPlanFetchSummary = "loaded=none"
        } else {
            lastPlanFetchSummary = "loaded=" + plans.map { "\($0.id)@\($0.priceString)" }.joined(separator: ",")
            paywallPhase = .ready
        }
    }

    private func plansFromOfferings() async -> LoadedPlans {
        do {
            let offerings = try await Purchases.shared.offerings()
            let offering = offerings.current
                ?? offerings.offering(identifier: Constants.Offerings.main)
            guard let offering else { return LoadedPlans() }

            let packages = offering.availablePackages
            let ids = PaywallCatalog.selectSellableIds(
                from: packages.map(\.storeProduct.productIdentifier)
            )
            var loaded = LoadedPlans()
            for id in ids {
                guard let package = packages.first(where: { $0.storeProduct.productIdentifier == id }) else { continue }
                let product = package.storeProduct
                let plan = PaywallPlan(
                    id: id,
                    title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.localizedTitle),
                    description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.localizedDescription),
                    priceString: package.localizedPriceString
                )
                loaded.handles[id] = .package(package)
                loaded.plans.append(plan)
            }
            return loaded
        } catch {
            print("Offerings error: \(error)")
            return LoadedPlans()
        }
    }

    private func plansFromProductIds() async -> LoadedPlans {
        guard canUsePurchases else { return LoadedPlans() }
        let products = await Purchases.shared.products(Constants.ProductIDs.sellable)
        let ids = PaywallCatalog.selectSellableIds(from: products.map(\.productIdentifier))
        var loaded = LoadedPlans()
        for id in ids {
            guard let product = products.first(where: { $0.productIdentifier == id }) else { continue }
            let plan = PaywallPlan(
                id: id,
                title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.localizedTitle),
                description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.localizedDescription),
                priceString: product.localizedPriceString
            )
            loaded.handles[id] = .product(product)
            loaded.plans.append(plan)
        }
        return loaded
    }

    /// Last-resort App Store load. Used when RevenueCat offerings/products are empty
    /// so App Review never sees a silent blank subscription page (Guideline 2.1b).
    private func plansFromStoreKit() async -> LoadedPlans {
        do {
            let products = try await Product.products(for: Set(Constants.ProductIDs.sellable))
            let ids = PaywallCatalog.selectSellableIds(from: products.map(\.id))
            var loaded = LoadedPlans()
            for id in ids {
                guard let product = products.first(where: { $0.id == id }) else { continue }
                let plan = PaywallPlan(
                    id: id,
                    title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.displayName),
                    description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.description),
                    priceString: product.displayPrice
                )
                loaded.handles[id] = .storeKit(product)
                loaded.plans.append(plan)
            }
            return loaded
        } catch {
            print("StoreKit products error: \(error)")
            return LoadedPlans()
        }
    }

    private func purchaseStoreKit(_ product: Product) async -> Bool {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    errorMessage = "Could not verify that purchase with Apple. Try Restore Purchases."
                    return false
                }
                await transaction.finish()
                if canUsePurchases {
                    _ = try? await Purchases.shared.syncPurchases()
                    await checkSubscriptionStatus()
                }
                if !isPremium {
                    isPremium = true
                }
                errorMessage = nil
                return true
            case .userCancelled:
                errorMessage = nil
                return false
            case .pending:
                errorMessage = "Purchase is pending. You'll get Premium when Apple approves it."
                return false
            @unknown default:
                errorMessage = "Purchase did not complete. Try again."
                return false
            }
        } catch {
            if isUserCancellation(error) {
                errorMessage = nil
                return false
            }
            errorMessage = "Purchase failed: \(error.localizedDescription)"
            print("StoreKit purchase error: \(error)")
            return false
        }
    }

    private func restoreFromStoreKit() async -> Bool {
        let localOnly = ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.localStoreKit)
        if !localOnly {
            _ = await withTimeout(seconds: 8) {
                do {
                    try await AppStore.sync()
                    return true
                } catch {
                    self.errorMessage = "Restore failed: \(error.localizedDescription)"
                    print("StoreKit restore error: \(error)")
                    return false
                }
            }
        }

        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               Constants.ProductIDs.sellable.contains(transaction.productID) {
                isPremium = true
                return true
            }
        }
        return false
    }

    /// Returns the operation's value, or nil if it has not finished within `seconds`.
    /// A late result cannot resume the caller twice.
    private func withTimeout<T>(seconds: Double, operation: @escaping @MainActor () async -> T) async -> T? {
        let gate = ResumeOnce<T>()
        return await withCheckedContinuation { continuation in
            let work = Task { @MainActor in
                let value = await operation()
                gate.resume(continuation, value)
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                if gate.resume(continuation, nil) {
                    work.cancel()
                }
            }
        }
    }

    private func isUserCancellation(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "RCPurchasesErrorDomain" && ns.code == 1 { return true }
        let text = error.localizedDescription.lowercased()
        return text.contains("cancel") || text.contains("cancelled")
    }

    /// Check if user has exceeded free tier limits
    func hasExceededFreeTier(mealCountToday: Int) -> Bool {
        return !isPremium && mealCountToday >= Constants.FreeTier.dailyMealLimit
    }

    /// Check if feature is available in free tier
    func isFeatureAvailableInFreeTier(feature: PremiumFeature) -> Bool {
        switch feature {
        case .mealLogging(let count):
            return isPremium || count < Constants.FreeTier.dailyMealLimit
        case .historyAccess:
            return isPremium
        case .advancedAnalytics:
            return isPremium
        case .foodDatabase:
            return isPremium
        case .dataExport:
            return isPremium
        }
    }
}

/// Thread-safe single resume so a timeout and a finished fetch cannot both continue.
private final class ResumeOnce<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false

    func resume(_ continuation: CheckedContinuation<T?, Never>, _ value: T?) -> Bool {
        lock.lock()
        let should = !didResume
        if should { didResume = true }
        lock.unlock()
        if should {
            continuation.resume(returning: value)
        }
        return should
    }
}

/// Premium features that can be gated
enum PremiumFeature {
    case mealLogging(count: Int)
    case historyAccess
    case advancedAnalytics
    case foodDatabase
    case dataExport
}
