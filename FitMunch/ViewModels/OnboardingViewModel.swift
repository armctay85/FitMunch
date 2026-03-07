import Foundation
import SwiftUI

/// ViewModel for the onboarding/paywall screen
@MainActor
class OnboardingViewModel: ObservableObject {
    @Published var currentStep: Int = 0
    @Published var name: String = ""
    @Published var email: String = ""
    @Published var selectedGoal: Constants.FitnessGoals = .maintenance
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    private let premiumManager = PremiumManager.shared
    
    /// Total number of onboarding steps
    let totalSteps = 3
    
    /// Move to the next onboarding step
    func nextStep() {
        if currentStep < totalSteps - 1 {
            currentStep += 1
        }
    }
    
    /// Move to the previous onboarding step
    func previousStep() {
        if currentStep > 0 {
            currentStep -= 1
        }
    }
    
    /// Complete onboarding and save user profile
    func completeOnboarding() async -> Bool {
        isLoading = true
        defer { isLoading = false }
        
        // Validate inputs
        guard !name.isEmpty else {
            errorMessage = "Please enter your name"
            return false
        }
        
        guard !email.isEmpty, isValidEmail(email) else {
            errorMessage = "Please enter a valid email address"
            return false
        }
        
        // Save to UserDefaults
        UserDefaults.standard.set(true, forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
        
        // In a real app, you would save the user profile to SwiftData here
        // For now, we'll just mark onboarding as complete
        
        errorMessage = nil
        return true
    }
    
    /// Check if email is valid
    private func isValidEmail(_ email: String) -> Bool {
        let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,64}"
        let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        return emailPredicate.evaluate(with: email)
    }
    
    /// Get current step title
    var currentStepTitle: String {
        switch currentStep {
        case 0: return "Welcome to FitMunch"
        case 1: return "Set Your Goals"
        case 2: return "Choose Your Plan"
        default: return ""
        }
    }
    
    /// Get current step description
    var currentStepDescription: String {
        switch currentStep {
        case 0: return "Track your meals, reach your fitness goals, and make healthy eating simple."
        case 1: return "Tell us about your fitness goals so we can personalize your experience."
        case 2: return "Unlock premium features for better tracking and insights."
        default: return ""
        }
    }
}