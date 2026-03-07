import Foundation
import SwiftData
import SwiftUI

/// ViewModel for the home screen
@MainActor
class HomeViewModel: ObservableObject {
    @Published var selectedDate: Date = Date()
    @Published var meals: [Meal] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    @Published var totalCalories: Int = 0
    @Published var totalProtein: Int = 0
    @Published var totalCarbs: Int = 0
    @Published var totalFats: Int = 0
    
    private let modelContext: ModelContext
    private let premiumManager = PremiumManager.shared
    
    /// Initialize with model context
    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadMealsForSelectedDate()
    }
    
    /// Load meals for the selected date
    func loadMealsForSelectedDate() {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let calendar = Calendar.current
            let startOfDay = calendar.startOfDay(for: selectedDate)
            let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!
            
            let descriptor = FetchDescriptor<Meal>(
                predicate: #Predicate { meal in
                    meal.date >= startOfDay && meal.date < endOfDay
                },
                sortBy: [SortDescriptor(\.date, order: .forward)]
            )
            
            meals = try modelContext.fetch(descriptor)
            calculateTotals()
            errorMessage = nil
        } catch {
            errorMessage = "Failed to load meals: \(error.localizedDescription)"
            print("Error loading meals: \(error)")
        }
    }
    
    /// Calculate nutritional totals for the day
    private func calculateTotals() {
        totalCalories = meals.reduce(0) { $0 + $1.totalCalories }
        totalProtein = meals.reduce(0) { $0 + $1.totalProtein }
        totalCarbs = meals.reduce(0) { $0 + $1.totalCarbs }
        totalFats = meals.reduce(0) { $0 + $1.totalFats }
    }
    
    /// Check if user can log another meal (free tier limit)
    var canLogMeal: Bool {
        return premiumManager.isFeatureAvailableInFreeTier(feature: .mealLogging(count: meals.count))
    }
    
    /// Get progress for a specific nutrient
    func progress(for nutrient: NutrientType, goal: Int) -> Double {
        let currentValue: Int
        switch nutrient {
        case .calories: currentValue = totalCalories
        case .protein: currentValue = totalProtein
        case .carbs: currentValue = totalCarbs
        case .fats: currentValue = totalFats
        }
        
        guard goal > 0 else { return 0 }
        return min(Double(currentValue) / Double(goal), 1.0)
    }
    
    /// Delete a meal
    func deleteMeal(_ meal: Meal) {
        modelContext.delete(meal)
        do {
            try modelContext.save()
            loadMealsForSelectedDate()
        } catch {
            errorMessage = "Failed to delete meal: \(error.localizedDescription)"
            print("Error deleting meal: \(error)")
        }
    }
    
    /// Format date for display
    var formattedDate: String {
        Constants.dateFormatter.string(from: selectedDate)
    }
    
    /// Check if selected date is today
    var isToday: Bool {
        Calendar.current.isDateInToday(selectedDate)
    }
    
    /// Navigate to previous day
    func previousDay() {
        if let newDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) {
            selectedDate = newDate
            loadMealsForSelectedDate()
        }
    }
    
    /// Navigate to next day
    func nextDay() {
        if let newDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate) {
            selectedDate = newDate
            loadMealsForSelectedDate()
        }
    }
}

/// Nutrient types for progress tracking
enum NutrientType {
    case calories
    case protein
    case carbs
    case fats
}