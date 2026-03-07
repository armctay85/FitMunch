import Foundation
import SwiftUI

/// ViewModel for the settings screen
@MainActor
class SettingsViewModel: ObservableObject {
    @Published var isDarkMode: Bool = false
    @Published var notificationsEnabled: Bool = true
    @Published var useMetricUnits: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var showContactSupport: Bool = false
    @Published var showPrivacyPolicy: Bool = false
    @Published var showTermsOfService: Bool = false
    
    private let premiumManager = PremiumManager.shared
    
    /// Current app version
    var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
    
    /// Current build number
    var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
    
    /// Load user preferences
    func loadPreferences() {
        isDarkMode = UserDefaults.standard.bool(forKey: "isDarkMode")
        notificationsEnabled = UserDefaults.standard.bool(forKey: "notificationsEnabled")
        useMetricUnits = UserDefaults.standard.bool(forKey: "useMetricUnits")
    }
    
    /// Save user preferences
    func savePreferences() {
        UserDefaults.standard.set(isDarkMode, forKey: "isDarkMode")
        UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled")
        UserDefaults.standard.set(useMetricUnits, forKey: "useMetricUnits")
    }
    
    /// Toggle dark mode
    func toggleDarkMode() {
        isDarkMode.toggle()
        savePreferences()
        
        // Apply theme change
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            windowScene.windows.forEach { window in
                window.overrideUserInterfaceStyle = isDarkMode ? .dark : .light
            }
        }
    }
    
    /// Toggle notifications
    func toggleNotifications() {
        notificationsEnabled.toggle()
        savePreferences()
        
        if notificationsEnabled {
            requestNotificationPermission()
        }
    }
    
    /// Request notification permission
    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.errorMessage = "Failed to enable notifications: \(error.localizedDescription)"
                } else if !granted {
                    self.errorMessage = "Notifications permission denied. Enable in Settings."
                }
            }
        }
    }
    
    /// Toggle metric units
    func toggleMetricUnits() {
        useMetricUnits.toggle()
        savePreferences()
    }
    
    /// Restore purchases
    func restorePurchases() async {
        isLoading = true
        defer { isLoading = false }
        
        let success = await premiumManager.restorePurchases()
        if success {
            errorMessage = "Purchases restored successfully"
        } else {
            errorMessage = "No purchases to restore or restore failed"
        }
    }
    
    /// Contact support
    func contactSupport() {
        showContactSupport = true
        
        // In a real app, this would open email or support form
        let supportEmail = "support@fitmunch.com.au"
        let subject = "FitMunch Support Request"
        let body = "App Version: \(appVersion) (\(buildNumber))\n\nPlease describe your issue:"
        
        if let url = URL(string: "mailto:\(supportEmail)?subject=\(subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")&body=\(body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
            UIApplication.shared.open(url)
        }
    }
    
    /// View privacy policy
    func viewPrivacyPolicy() {
        showPrivacyPolicy = true
        
        // In a real app, this would open a web view
        if let url = URL(string: "https://fitmunch.com.au/privacy") {
            UIApplication.shared.open(url)
        }
    }
    
    /// View terms of service
    func viewTermsOfService() {
        showTermsOfService = true
        
        // In a real app, this would open a web view
        if let url = URL(string: "https://fitmunch.com.au/terms") {
            UIApplication.shared.open(url)
        }
    }
    
    /// Log out user
    func logOut() {
        // Clear user data
        UserDefaults.standard.removeObject(forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
        
        // Clear SwiftData (in a real app)
        // Note: This would require more complex data management
        
        // Reset premium status
        premiumManager.isPremium = false
        
        // Navigate to onboarding (handled by parent view)
    }
    
    /// Check if user is subscribed
    var isSubscribed: Bool {
        return premiumManager.isPremium
    }
    
    /// Get subscription status text
    var subscriptionStatus: String {
        return isSubscribed ? "Premium Subscriber" : "Free Tier"
    }
    
    /// Get subscription status color
    var subscriptionStatusColor: Color {
        return isSubscribed ? .green : .orange
    }
    
    /// Check if user has completed onboarding
    var hasCompletedOnboarding: Bool {
        return UserDefaults.standard.bool(forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
    }
    
    /// Get user's display name (from UserDefaults or default)
    var userDisplayName: String {
        return UserDefaults.standard.string(forKey: "userDisplayName") ?? "User"
    }
    
    /// Get user's email (from UserDefaults or default)
    var userEmail: String {
        return UserDefaults.standard.string(forKey: "userEmail") ?? "user@example.com"
    }
}