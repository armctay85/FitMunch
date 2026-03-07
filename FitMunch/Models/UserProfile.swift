import Foundation
import SwiftData

/// Represents a user profile with fitness goals and preferences
@Model
final class UserProfile {
    var id: UUID
    var name: String
    var email: String
    var fitnessGoal: String
    var dailyCalorieGoal: Int
    var dailyProteinGoal: Int
    var dailyCarbGoal: Int
    var dailyFatGoal: Int
    
    @Relationship(deleteRule: .cascade, inverse: \Meal.userProfile)
    var meals: [Meal] = []
    
    /// Initialize a new user profile
    init(
        id: UUID = UUID(),
        name: String,
        email: String,
        fitnessGoal: String,
        dailyCalorieGoal: Int,
        dailyProteinGoal: Int,
        dailyCarbGoal: Int,
        dailyFatGoal: Int
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.fitnessGoal = fitnessGoal
        self.dailyCalorieGoal = dailyCalorieGoal
        self.dailyProteinGoal = dailyProteinGoal
        self.dailyCarbGoal = dailyCarbGoal
        self.dailyFatGoal = dailyFatGoal
    }
}