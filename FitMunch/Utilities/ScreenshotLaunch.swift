import Foundation
import SwiftData
import SwiftUI
import UIKit

/// App Store screenshot capture only. Launch the UI test with `-AppStoreScreenshots`.
/// Seeds real SwiftUI screens (Home, Coach, Scan, Plan, Settings) with no prices,
/// no Free / trial copy, and no paywall. Never used for production sessions.
enum ScreenshotLaunch {
    static let argument = "-AppStoreScreenshots"

    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains(argument)
    }

    /// Prepare UserDefaults and disable animations before the first frame.
    static func prepareSession() {
        guard isActive else { return }
        UserDefaults.standard.set(true, forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
        UserDefaults.standard.set("Alex Chen", forKey: "userDisplayName")
        UserDefaults.standard.set("alex@fitmunch.com.au", forKey: "userEmail")
        UserDefaults.standard.set(true, forKey: "useMetricUnits")
        // Match SettingsViewModel's initial toggle so loadPreferences does not
        // flip Notifications and present the system permission alert.
        UserDefaults.standard.set(true, forKey: "notificationsEnabled")
        UIView.setAnimationsEnabled(false)
    }

    /// Sample meals so Home looks like the app in use (Guideline 2.3.3).
    static func seedMealsIfNeeded(into context: ModelContext) {
        guard isActive else { return }
        let start = Calendar.current.startOfDay(for: Date())
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
        let descriptor = FetchDescriptor<Meal>(
            predicate: #Predicate { meal in
                meal.date >= start && meal.date < end
            }
        )
        let existing = (try? context.fetch(descriptor)) ?? []
        guard existing.isEmpty else { return }

        func addMeal(name: String, hour: Int, items: [(String, Int, Int, Int, Int)]) {
            var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
            components.hour = hour
            components.minute = 10
            let date = Calendar.current.date(from: components) ?? Date()
            let meal = Meal(name: name, date: date)
            context.insert(meal)
            for item in items {
                let food = FoodItem(
                    name: item.0,
                    calories: item.1,
                    protein: item.2,
                    carbs: item.3,
                    fats: item.4
                )
                food.meal = meal
                meal.foodItems.append(food)
                context.insert(food)
            }
            meal.updateTotals()
        }

        addMeal(name: "Breakfast", hour: 7, items: [
            ("Greek yoghurt bowl", 280, 24, 28, 8),
            ("Oats and berries", 210, 8, 36, 4),
        ])
        addMeal(name: "Lunch", hour: 12, items: [
            ("Grilled chicken salad", 420, 42, 18, 16),
        ])
        addMeal(name: "Dinner", hour: 18, items: [
            ("Salmon and rice", 540, 38, 48, 18),
        ])
        try? context.save()
    }

    /// Coach thread that reads as the real chat UI, with no price or trial copy.
    static func coachMessages() -> [CoachView.ChatMessage] {
        [
            CoachView.ChatMessage(role: "user", content: "What should I eat after training?"),
            CoachView.ChatMessage(
                role: "assistant",
                content: "Go for grilled chicken, rice, and broccoli. That lands you near 40g protein and keeps the rest of the day on target."
            ),
            CoachView.ChatMessage(role: "user", content: "Can you build tomorrow around that?"),
            CoachView.ChatMessage(
                role: "assistant",
                content: "Yes. Keep lunch similar, add yoghurt at breakfast, and use salmon at dinner so protein stays even across the day."
            ),
        ]
    }

    /// Meal plan already generated so Plan is the app in use, without a shop total.
    static func mealPlan() -> MealPlanPayload {
        MealPlanPayload(
            planName: "High protein training week",
            summary: "Chicken, fish, yoghurt, and rice across the week. Built from your calorie and protein targets.",
            days: [
                MealPlanDay(
                    day: "Monday",
                    meals: MealPlanMeals(
                        breakfast: MealPlanMeal(name: "Yoghurt, oats, berries", calories: 420, protein: 32, carbs: 48, fat: 10, prepMins: 8),
                        lunch: MealPlanMeal(name: "Chicken rice bowl", calories: 610, protein: 48, carbs: 62, fat: 14, prepMins: 15),
                        dinner: MealPlanMeal(name: "Salmon, potatoes, greens", calories: 680, protein: 44, carbs: 52, fat: 22, prepMins: 20),
                        snack: MealPlanMeal(name: "Cottage cheese and fruit", calories: 180, protein: 18, carbs: 16, fat: 4, prepMins: 3)
                    ),
                    dailyTotals: MealPlanTotals(calories: 1890, protein: 142, carbs: 178, fat: 50)
                ),
                MealPlanDay(
                    day: "Tuesday",
                    meals: MealPlanMeals(
                        breakfast: MealPlanMeal(name: "Eggs and toast", calories: 390, protein: 28, carbs: 32, fat: 16, prepMins: 10),
                        lunch: MealPlanMeal(name: "Turkey wrap and salad", calories: 560, protein: 40, carbs: 46, fat: 18, prepMins: 12),
                        dinner: MealPlanMeal(name: "Beef mince and rice", calories: 720, protein: 46, carbs: 58, fat: 24, prepMins: 18),
                        snack: MealPlanMeal(name: "Protein yoghurt", calories: 160, protein: 20, carbs: 12, fat: 3, prepMins: 2)
                    ),
                    dailyTotals: MealPlanTotals(calories: 1830, protein: 134, carbs: 148, fat: 61)
                ),
            ],
            weeklyBudgetEst: nil,
            avgDailyCalories: 1860,
            avgDailyProtein: 138
        )
    }
}
