import Foundation
import SwiftData
import SwiftUI

/// ViewModel for the meal detail/logging screen
@MainActor
class DetailViewModel: ObservableObject {
    @Published var mealName: String = ""
    @Published var searchQuery: String = ""
    @Published var foodItems: [FoodItem] = []
    @Published var searchResults: [FoodItem] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var isEditing: Bool = false
    
    private let modelContext: ModelContext
    private var existingMeal: Meal?
    
    /// Initialize for creating a new meal
    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }
    
    /// Initialize for editing an existing meal
    convenience init(modelContext: ModelContext, meal: Meal) {
        self.init(modelContext: modelContext)
        self.existingMeal = meal
        self.mealName = meal.name
        self.foodItems = meal.foodItems
        self.isEditing = true
    }
    
    /// No food catalogue is connected. Search stays empty instead of filtering
    /// a shrinking copy of itself, which could never restore earlier matches.
    func searchFoods() {
        searchResults = []
    }

    /// Manual entry. Used until a real nutrition source is wired up.
    func addManualFood(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        foodItems.append(
            FoodItem(name: trimmed, quantity: 1, calories: 0, protein: 0, carbs: 0, fats: 0)
        )
        searchQuery = ""
        searchResults = []
    }
    
    /// Add a food item to the meal
    func addFoodItem(_ foodItem: FoodItem, quantity: Double = 1.0) {
        let newFoodItem = FoodItem(
            name: foodItem.name,
            quantity: quantity,
            calories: foodItem.calories,
            protein: foodItem.protein,
            carbs: foodItem.carbs,
            fats: foodItem.fats
        )
        
        // Adjust nutritional values for the specified quantity
        let multiplier = quantity / foodItem.quantity
        newFoodItem.calories = Int(Double(foodItem.calories) * multiplier)
        newFoodItem.protein = Int(Double(foodItem.protein) * multiplier)
        newFoodItem.carbs = Int(Double(foodItem.carbs) * multiplier)
        newFoodItem.fats = Int(Double(foodItem.fats) * multiplier)
        
        foodItems.append(newFoodItem)
        searchQuery = ""
        searchResults = []
    }
    
    /// Remove a food item from the meal
    func removeFoodItem(at index: Int) {
        guard index < foodItems.count else { return }
        foodItems.remove(at: index)
    }
    
    /// Calculate total nutritional values for the meal
    var totalNutrition: (calories: Int, protein: Int, carbs: Int, fats: Int) {
        return foodItems.reduce((0, 0, 0, 0)) { totals, item in
            (
                totals.0 + item.calories,
                totals.1 + item.protein,
                totals.2 + item.carbs,
                totals.3 + item.fats
            )
        }
    }
    
    /// Save the meal
    func saveMeal() async -> Bool {
        isLoading = true
        defer { isLoading = false }
        
        // Validate meal name
        guard !mealName.isEmpty else {
            errorMessage = "Please enter a meal name"
            return false
        }
        
        // Validate at least one food item
        guard !foodItems.isEmpty else {
            errorMessage = "Please add at least one food item"
            return false
        }
        
        do {
            let meal: Meal
            
            if let existingMeal = existingMeal {
                // Update existing meal
                meal = existingMeal
                meal.name = mealName
                meal.foodItems = foodItems
                meal.updateTotals()
            } else {
                // Create new meal
                meal = Meal(
                    name: mealName,
                    date: Date(),
                    totalCalories: totalNutrition.calories,
                    totalProtein: totalNutrition.protein,
                    totalCarbs: totalNutrition.carbs,
                    totalFats: totalNutrition.fats
                )
                meal.foodItems = foodItems
                modelContext.insert(meal)
            }
            
            try modelContext.save()
            // Mirror to the FitMunch backend so web + AI coach see this meal.
            MealSync.push(
                name: meal.name,
                calories: meal.totalCalories,
                protein: meal.totalProtein,
                carbs: meal.totalCarbs,
                fats: meal.totalFats,
                date: meal.date
            )
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Failed to save meal: \(error.localizedDescription)"
            print("Meal write failed: \(error)")
            return false
        }
    }
    
    /// Check if meal can be saved
    var canSave: Bool {
        return !mealName.isEmpty && !foodItems.isEmpty
    }
}