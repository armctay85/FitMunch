import Foundation
import SwiftData

/// Represents a meal with its nutritional information
@Model
final class Meal {
    var id: UUID
    var name: String
    var date: Date
    var totalCalories: Int
    var totalProtein: Int
    var totalCarbs: Int
    var totalFats: Int
    
    var userProfile: UserProfile?
    
    @Relationship(deleteRule: .cascade, inverse: \FoodItem.meal)
    var foodItems: [FoodItem] = []
    
    /// Initialize a new meal
    init(
        id: UUID = UUID(),
        name: String,
        date: Date = Date(),
        totalCalories: Int = 0,
        totalProtein: Int = 0,
        totalCarbs: Int = 0,
        totalFats: Int = 0
    ) {
        self.id = id
        self.name = name
        self.date = date
        self.totalCalories = totalCalories
        self.totalProtein = totalProtein
        self.totalCarbs = totalCarbs
        self.totalFats = totalFats
    }
    
    /// Update meal totals based on food items
    func updateTotals() {
        totalCalories = foodItems.reduce(0) { $0 + $1.calories }
        totalProtein = foodItems.reduce(0) { $0 + $1.protein }
        totalCarbs = foodItems.reduce(0) { $0 + $1.carbs }
        totalFats = foodItems.reduce(0) { $0 + $1.fats }
    }
}