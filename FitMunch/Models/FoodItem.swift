import Foundation
import SwiftData

/// Represents a food item with nutritional information
@Model
final class FoodItem {
    var id: UUID
    var name: String
    var quantity: Double
    var calories: Int
    var protein: Int
    var carbs: Int
    var fats: Int
    
    var meal: Meal?
    
    /// Initialize a new food item
    init(
        id: UUID = UUID(),
        name: String,
        quantity: Double = 1.0,
        calories: Int,
        protein: Int,
        carbs: Int,
        fats: Int
    ) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fats = fats
    }
    
    /// Calculate nutritional values for a given quantity
    func nutritionalValues(for quantity: Double) -> (calories: Int, protein: Int, carbs: Int, fats: Int) {
        let multiplier = quantity / self.quantity
        return (
            calories: Int(Double(calories) * multiplier),
            protein: Int(Double(protein) * multiplier),
            carbs: Int(Double(carbs) * multiplier),
            fats: Int(Double(fats) * multiplier)
        )
    }
}