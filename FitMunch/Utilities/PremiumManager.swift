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

    static let shared = PremiumManager()

    private var planHandles: [String: PlanHandle] = [:]

    private enum PlanHandle {
        case package(Package)
        case product(StoreProduct)
        case storeKit(Product)
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
    func restorePurchases() async -> Bool {
        isLoading = true
        defer { isLoading = false }

        if canUsePurchases {
            do {
                let customerInfo = try await Purchases.shared.restorePurchases()
                isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
                if isPremium {
                    errorMessage = nil
                    return true
                }
            } catch {
                errorMessage = "Restore failed: \(error.localizedDescription)"
                print("Restore error: \(error)")
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

    /// Load monthly/annual plans. Never throws into UI. Empty offerings return [].
    /// Order: RevenueCat current offering, then `main`, then RC product IDs, then StoreKit 2.
    func getPlans() async -> [PaywallPlan] {
        planHandles = [:]
        var plans: [PaywallPlan] = []

        if canUsePurchases {
            if let fromOffering = await plansFromOfferings() {
                plans = fromOffering
            }
            if plans.isEmpty {
                plans = await plansFromProductIds()
            }
        }
        if plans.isEmpty {
            plans = await plansFromStoreKit()
        }

        if plans.isEmpty {
            errorMessage = canUsePurchases
                ? "Could not load App Store plans. Tap Retry, or check your connection and try again."
                : "In-app plans are not configured. Retry, or continue on fitmunch.com.au to start Premium."
        } else {
            errorMessage = nil
        }
        return plans
    }

    private func plansFromOfferings() async -> [PaywallPlan]? {
        do {
            let offerings = try await Purchases.shared.offerings()
            let offering = offerings.current
                ?? offerings.offering(identifier: Constants.Offerings.main)
            guard let offering else { return [] }

            let packages = offering.availablePackages
            var titles: [String: String] = [:]
            for pkg in packages {
                titles[pkg.storeProduct.productIdentifier] = pkg.storeProduct.localizedTitle
            }
            let ids = PaywallCatalog.selectSellableIds(
                from: packages.map(\.storeProduct.productIdentifier),
                titles: titles
            )
            var plans: [PaywallPlan] = []
            for id in ids {
                guard let package = packages.first(where: { $0.storeProduct.productIdentifier == id }) else { continue }
                let product = package.storeProduct
                if PaywallCatalog.isWeeklyMissingMetadata(productId: id, title: product.localizedTitle) {
                    continue
                }
                let plan = PaywallPlan(
                    id: id,
                    title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.localizedTitle),
                    description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.localizedDescription),
                    priceString: package.localizedPriceString
                )
                planHandles[id] = .package(package)
                plans.append(plan)
            }
            return plans
        } catch {
            errorMessage = "Could not load plans: \(error.localizedDescription)"
            print("Offerings error: \(error)")
            return nil
        }
    }

    private func plansFromProductIds() async -> [PaywallPlan] {
        guard canUsePurchases else { return [] }
        let products = await Purchases.shared.products(Constants.ProductIDs.sellable)
        var titles: [String: String] = [:]
        for product in products {
            titles[product.productIdentifier] = product.localizedTitle
        }
        let ids = PaywallCatalog.selectSellableIds(
            from: products.map(\.productIdentifier),
            titles: titles
        )
        var plans: [PaywallPlan] = []
        for id in ids {
            guard let product = products.first(where: { $0.productIdentifier == id }) else { continue }
            let plan = PaywallPlan(
                id: id,
                title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.localizedTitle),
                description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.localizedDescription),
                priceString: product.localizedPriceString
            )
            planHandles[id] = .product(product)
            plans.append(plan)
        }
        return plans
    }

    /// Last-resort App Store load. Used when RevenueCat offerings/products are empty
    /// so App Review never sees a silent blank subscription page (Guideline 2.1b).
    private func plansFromStoreKit() async -> [PaywallPlan] {
        do {
            let products = try await Product.products(for: Set(Constants.ProductIDs.sellable))
            var titles: [String: String] = [:]
            for product in products {
                titles[product.id] = product.displayName
            }
            let ids = PaywallCatalog.selectSellableIds(
                from: products.map(\.id),
                titles: titles
            )
            var plans: [PaywallPlan] = []
            for id in ids {
                guard let product = products.first(where: { $0.id == id }) else { continue }
                let plan = PaywallPlan(
                    id: id,
                    title: PaywallCatalog.displayTitle(productId: id, storeTitle: product.displayName),
                    description: PaywallCatalog.displayDescription(productId: id, storeDescription: product.description),
                    priceString: product.displayPrice
                )
                planHandles[id] = .storeKit(product)
                plans.append(plan)
            }
            return plans
        } catch {
            errorMessage = "Could not load App Store plans: \(error.localizedDescription)"
            print("StoreKit products error: \(error)")
            return []
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
        do {
            try await AppStore.sync()
            for await result in Transaction.currentEntitlements {
                if case .verified(let transaction) = result,
                   Constants.ProductIDs.sellable.contains(transaction.productID) {
                    isPremium = true
                    return true
                }
            }
        } catch {
            errorMessage = "Restore failed: \(error.localizedDescription)"
            print("StoreKit restore error: \(error)")
        }
        return false
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

/// Premium features that can be gated
enum PremiumFeature {
    case mealLogging(count: Int)
    case historyAccess
    case advancedAnalytics
    case foodDatabase
    case dataExport
}
