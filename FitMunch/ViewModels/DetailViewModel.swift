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
    /// The quick-add row, so typing calories updates one item instead of appending.
    private var quickEntryID: UUID?
    
    /// Initialize for creating a new meal. The name is the time-of-day slot.
    init(modelContext: ModelContext, now: Date = Date()) {
        self.modelContext = modelContext
        self.mealName = MealTimeName.name(for: now)
    }
    
    /// Initialize for editing an existing meal
    convenience init(modelContext: ModelContext, meal: Meal) {
        self.init(modelContext: modelContext)
        self.existingMeal = meal
        self.mealName = meal.name
        self.foodItems = meal.foodItems
        self.isEditing = true
    }
    
    /// No food search source is connected. Search stays empty instead of filtering
    /// a shrinking copy of itself, which could never restore earlier matches.
    func searchFoods() {
        searchResults = []
    }

    /// Manual entry. Used until a real nutrition source is wired up.
    /// Calories stay 0: there is no food database to look up.
    func addManualFood(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        foodItems.append(
            FoodItem(name: trimmed, quantity: 1, calories: 0, protein: 0, carbs: 0, fats: 0)
        )
        searchQuery = ""
        searchResults = []
    }

    /// One-step entry. The numbers are what the person typed. The name is the
    /// meal slot, not a food looked up from anywhere.
    func setQuickEntry(calories: Int, protein: Int, carbs: Int, fats: Int) {
        let label = mealName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard calories > 0, !label.isEmpty else {
            removeQuickEntry()
            return
        }
        if let id = quickEntryID, let index = foodItems.firstIndex(where: { $0.id == id }) {
            let item = foodItems[index]
            item.name = label
            item.quantity = 1
            item.calories = calories
            item.protein = max(protein, 0)
            item.carbs = max(carbs, 0)
            item.fats = max(fats, 0)
            return
        }
        let item = FoodItem(
            name: label,
            quantity: 1,
            calories: calories,
            protein: max(protein, 0),
            carbs: max(carbs, 0),
            fats: max(fats, 0)
        )
        quickEntryID = item.id
        foodItems.append(item)
    }

    /// Saved meals with real calories, newest first, one row per name.
    func recentLogs(limit: Int = 4) -> [Meal] {
        var descriptor = FetchDescriptor<Meal>(
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        descriptor.fetchLimit = 24
        let meals = (try? modelContext.fetch(descriptor)) ?? []
        var seen = Set<String>()
        var picked: [Meal] = []
        for meal in meals where meal.totalCalories > 0 {
            let key = meal.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !key.isEmpty, seen.insert(key).inserted else { continue }
            picked.append(meal)
            if picked.count == limit { break }
        }
        return picked
    }

    /// Copies a saved meal's name and macros into a new meal. One tap.
    func relog(_ source: Meal) async -> Bool {
        existingMeal = nil
        quickEntryID = nil
        mealName = source.name
        let copies = source.foodItems.map { item in
            FoodItem(
                name: item.name,
                quantity: item.quantity,
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fats: item.fats
            )
        }
        if copies.isEmpty {
            foodItems = [
                FoodItem(
                    name: source.name,
                    quantity: 1,
                    calories: source.totalCalories,
                    protein: source.totalProtein,
                    carbs: source.totalCarbs,
                    fats: source.totalFats
                )
            ]
        } else {
            foodItems = copies
        }
        return await saveMeal()
    }

    private func removeQuickEntry() {
        if let id = quickEntryID, let index = foodItems.firstIndex(where: { $0.id == id }) {
            foodItems.remove(at: index)
        }
        quickEntryID = nil
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
        if foodItems[index].id == quickEntryID {
            quickEntryID = nil
        }
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
                modelContext.insert(meal)
                for item in foodItems {
                    item.meal = meal
                    if item.modelContext == nil {
                        modelContext.insert(item)
                    }
                }
                meal.foodItems = foodItems
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