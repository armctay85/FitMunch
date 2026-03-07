import Foundation

/// Application constants and configuration
enum Constants {
    /// App name
    static let appName = "FitMunch"
    
    /// RevenueCat API key (to be configured in production)
    static let revenueCatApiKey = "appl_xxx" // Replace with actual API key
    
    /// Subscription entitlement IDs
    enum Entitlements {
        static let premium = "premium"
    }
    
    /// Subscription offering IDs
    enum Offerings {
        static let main = "main"
    }
    
    /// User defaults keys
    enum UserDefaultsKeys {
        static let hasCompletedOnboarding = "hasCompletedOnboarding"
        static let dailyMealLimit = "dailyMealLimit"
        static let lastAppVersion = "lastAppVersion"
    }
    
    /// Free tier limits
    enum FreeTier {
        static let dailyMealLimit = 3
        static let historyDaysLimit = 7
    }
    
    /// Default nutritional goals
    enum DefaultGoals {
        static let dailyCalories = 2000
        static let dailyProtein = 150 // grams
        static let dailyCarbs = 250   // grams
        static let dailyFats = 65     // grams
    }
    
    /// Fitness goal options
    enum FitnessGoals: String, CaseIterable {
        case weightLoss = "weight_loss"
        case muscleGain = "muscle_gain"
        case maintenance = "maintenance"
        case endurance = "endurance"
        
        var displayName: String {
            switch self {
            case .weightLoss: return "Weight Loss"
            case .muscleGain: return "Muscle Gain"
            case .maintenance: return "Maintenance"
            case .endurance: return "Endurance"
            }
        }
    }
    
    /// Notification identifiers
    enum Notifications {
        static let mealReminder = "mealReminder"
        static let progressUpdate = "progressUpdate"
    }
    
    /// Date formatting
    static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
    
    /// Time formatting
    static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}