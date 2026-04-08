import Foundation
import RevenueCat
import SwiftUI

/// Manages premium subscription status and purchases
@MainActor
class PremiumManager: ObservableObject {
    @Published var isPremium: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    static let shared = PremiumManager()
    
    private init() {
        configureRevenueCat()
    }
    
    /// Configure RevenueCat with API key
    private func configureRevenueCat() {
        guard Constants.isRevenueCatConfigured else {
            errorMessage = "RevenueCat is not configured. Add REVENUECAT_API_KEY in Info.plist."
            print("RevenueCat not configured: missing REVENUECAT_API_KEY")
            return
        }

        Purchases.logLevel = .debug
        Purchases.configure(
            with: Configuration.Builder(withAPIKey: Constants.revenueCatApiKey)
                .with(usesStoreKit2IfAvailable: true)
                .build()
        )
        
        // Check initial subscription status
        Task {
            await checkSubscriptionStatus()
        }
    }
    
    /// Check current subscription status
    func checkSubscriptionStatus() async {
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
    
    /// Purchase a subscription package
    func purchase(package: Package) async -> Bool {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let purchaseResult = try await Purchases.shared.purchase(package: package)
            let transaction = purchaseResult.transaction
            let customerInfo = purchaseResult.customerInfo
            
            isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
            
            if let transaction = transaction {
                print("Purchase successful: \(transaction)")
            }
            
            return isPremium
        } catch {
            errorMessage = "Purchase failed: \(error.localizedDescription)"
            print("Purchase error: \(error)")
            return false
        }
    }
    
    /// Restore previous purchases
    func restorePurchases() async -> Bool {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let customerInfo = try await Purchases.shared.restorePurchases()
            isPremium = customerInfo.entitlements[Constants.Entitlements.premium]?.isActive == true
            errorMessage = nil
            return isPremium
        } catch {
            errorMessage = "Restore failed: \(error.localizedDescription)"
            print("Restore error: \(error)")
            return false
        }
    }
    
    /// Get available subscription packages
    func getPackages() async -> [Package] {
        do {
            let offerings = try await Purchases.shared.offerings()
            guard let offering = offerings.current else {
                return []
            }
            return offering.availablePackages
        } catch {
            errorMessage = "Failed to load packages: \(error.localizedDescription)"
            print("Offerings error: \(error)")
            return []
        }
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