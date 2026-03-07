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
        loadSampleFoods()
    }
    
    /// Initialize for editing an existing meal
    convenience init(modelContext: ModelContext, meal: Meal) {
        self.init(modelContext: modelContext)
        self.existingMeal = meal
        self.mealName = meal.name
        self.foodItems = meal.foodItems
        self.isEditing = true
    }
    
    /// Load sample foods for search
    private func loadSampleFoods() {
        // In a real app, this would come from a database
        // For now, we'll use sample data
        searchResults = [
            FoodItem(name: "Chicken Breast", quantity: 100, calories: 165, protein: 31, carbs: 0, fats: 3),
            FoodItem(name: "Brown Rice", quantity: 100, calories: 111, protein: 2, carbs: 23, fats: 1),
            FoodItem(name: "Broccoli", quantity: 100, calories: 34, protein: 3, carbs: 7, fats: 0),
            FoodItem(name: "Salmon", quantity: 100, calories: 208, protein: 20, carbs: 0, fats: 13),
            FoodItem(name: "Sweet Potato", quantity: 100, calories: 86, protein: 2, carbs: 20, fats: 0),
            FoodItem(name: "Avocado", quantity: 100, calories: 160, protein: 2, carbs: 9, fats: 15),
            FoodItem(name: "Eggs", quantity: 1, calories: 78, protein: 6, carbs: 1, fats: 5),
            FoodItem(name: "Greek Yogurt", quantity: 100, calories: 59, protein: 10, carbs: 4, fats: 0),
            FoodItem(name: "Banana", quantity: 1, calories: 105, protein: 1, carbs: 27, fats: 0),
            FoodItem(name: "Almonds", quantity: 28, calories: 164, protein: 6, carbs: 6, fats: 14)
        ]
    }
    
    /// Search for foods based on query
    func searchFoods() {
        guard !searchQuery.isEmpty else {
            searchResults = []
            return
        }
        
        let query = searchQuery.lowercased()
        searchResults = searchResults.filter { $0.name.lowercased().contains(query) }
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
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Failed to save meal: \(error.localizedDescription)"
            print("Error saving meal: \(error)")
            return false
        }
    }
    
    /// Check if meal can be saved
    var canSave: Bool {
        return !mealName.isEmpty && !foodItems.isEmpty
    }
}