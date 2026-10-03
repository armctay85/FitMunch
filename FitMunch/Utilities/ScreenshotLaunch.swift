import Foundation
import SwiftData
import SwiftUI
import UIKit

/// App Store screenshot capture only. Launch the UI test with `-AppStoreScreenshots`.
/// Seeds real SwiftUI screens (Home, Coach, Scan, Plan, Settings) with no prices,
/// no Free / trial copy, and no paywall. Never used for production sessions.
/// App Review / UITest path: logged-in free user so Upgrade and Scan are tappable.
enum ReviewLaunch {
    static let argument = "-ReviewGuards"

    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains(argument)
    }

    static func prepareSession() {
        guard isActive else { return }
        UserDefaults.standard.set(true, forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
        UserDefaults.standard.set("Reviewer", forKey: "userDisplayName")
        UserDefaults.standard.set("review@fitmunch.com.au", forKey: "userEmail")
        UserDefaults.standard.set(true, forKey: "notificationsEnabled")
    }
}

enum ScreenshotLaunch {
    static let argument = "-AppStoreScreenshots"

    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains(argument)
    }

    /// Prepare UserDefaults and disable animations before the first frame.
    static func prepareSession() {
        guard isActive else { return }
        UserDefaults.standard.set(true, forKey: Constants.UserDefaultsKeys.hasCompletedOnboarding)
        // Demo household, not a real person.
        UserDefaults.standard.set("Household", forKey: "userDisplayName")
        UserDefaults.standard.set("hello@fitmunch.com.au", forKey: "userEmail")
        UserDefaults.standard.set(true, forKey: "useMetricUnits")
        UserDefaults.standard.set(false, forKey: "isDarkMode")
        // Match SettingsViewModel's initial toggle so loadPreferences does not
        // flip Notifications and present the system permission alert.
        UserDefaults.standard.set(true, forKey: "notificationsEnabled")
        // In-app steps counter only. Not HealthKit.
        UserDefaults.standard.set(10000, forKey: "stepsGoal")
        UserDefaults.standard.set(6400, forKey: "stepsToday")
        UserDefaults.standard.set("Monday", forKey: "completedWorkoutDays")
        UIView.setAnimationsEnabled(false)
        pinWindowsToScreen()
    }

    /// XCTest screenshots letterbox when the scene stays at its initial frame.
    /// Pin every window to the screen so the capture is full bleed.
    static func pinWindowsToScreen() {
        guard isActive else { return }
        for scene in UIApplication.shared.connectedScenes {
            guard let scene = scene as? UIWindowScene else { continue }
            let bounds = scene.screen.bounds
            for window in scene.windows {
                window.overrideUserInterfaceStyle = .light
                window.frame = bounds
                window.rootViewController?.view.frame = bounds
                window.layoutIfNeeded()
            }
        }
    }

    /// Sample meals so Home looks like the app in use (Guideline 2.3.3).
    static func seedMealsIfNeeded(into context: ModelContext) {
        guard isActive else { return }
        seedHistoryDaysIfNeeded(into: context)
        seedWorkoutLogIfNeeded(into: context)
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
        addMeal(name: "Snack", hour: 15, items: [
            ("Banana", 105, 1, 27, 0),
        ])
        try? context.save()
    }

    /// Earlier days so History shows a week of meals and a calorie chart.
    /// Screenshot mode only. Does not run for a normal launch.
    private static func seedHistoryDaysIfNeeded(into context: ModelContext) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let all = (try? context.fetch(FetchDescriptor<Meal>())) ?? []
        let prior = all.filter { calendar.startOfDay(for: $0.date) < today }
        guard prior.isEmpty else { return }

        let days: [(Int, String, Int, Int, Int, Int)] = [
            (1, "Chicken rice bowl", 610, 48, 62, 14),
            (2, "Turkey wrap", 560, 40, 46, 18),
            (3, "Salmon and potatoes", 680, 44, 52, 22),
            (4, "Eggs and toast", 390, 28, 32, 16),
            (5, "Yoghurt and oats", 420, 32, 48, 10),
            (6, "Beef mince and rice", 720, 46, 58, 24),
        ]
        for entry in days {
            guard let day = calendar.date(byAdding: .day, value: -entry.0, to: today) else { continue }
            var components = calendar.dateComponents([.year, .month, .day], from: day)
            components.hour = 12
            components.minute = 30
            let when = calendar.date(from: components) ?? day
            let meal = Meal(name: entry.1, date: when)
            context.insert(meal)
            let food = FoodItem(
                name: entry.1,
                calories: entry.2,
                protein: entry.3,
                carbs: entry.4,
                fats: entry.5
            )
            food.meal = meal
            meal.foodItems.append(food)
            context.insert(food)
            meal.updateTotals()
        }
        try? context.save()
    }

    /// One logged exercise so Workout is the app in use. The weekly plan itself
    /// still comes from WorkoutPlanGenerator on appear.
    private static func seedWorkoutLogIfNeeded(into context: ModelContext) {
        let existing = (try? context.fetch(FetchDescriptor<WorkoutLog>())) ?? []
        guard existing.isEmpty else { return }
        let log = WorkoutLog(name: "Goblet Squats", sets: 3, reps: "10", weight: 16)
        context.insert(log)
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
                day("Wednesday", "Porridge and banana", 410, 18, "Tuna salad", 520, 42, "Chicken stir fry", 640, 46, 1760, 124),
                day("Thursday", "Eggs and spinach", 380, 26, "Beef salad", 590, 44, "Barramundi and rice", 670, 48, 1800, 136),
                day("Friday", "Yoghurt and oats", 400, 30, "Chicken wrap", 560, 41, "Lamb mince and potatoes", 710, 46, 1840, 135),
                day("Saturday", "Smoothie bowl", 430, 22, "Salmon salad", 540, 40, "Steak and vegetables", 690, 49, 1820, 129),
                day("Sunday", "Eggs and tomatoes", 360, 24, "Turkey rice bowl", 580, 43, "Roast chicken and greens", 650, 52, 1750, 137),
            ],
            weeklyBudgetEst: nil,
            avgDailyCalories: 1810,
            avgDailyProtein: 136
        )
    }

    private static func day(
        _ name: String,
        _ breakfast: String, _ breakfastKcal: Int, _ breakfastProtein: Int,
        _ lunch: String, _ lunchKcal: Int, _ lunchProtein: Int,
        _ dinner: String, _ dinnerKcal: Int, _ dinnerProtein: Int,
        _ calories: Int, _ protein: Int
    ) -> MealPlanDay {
        MealPlanDay(
            day: name,
            meals: MealPlanMeals(
                breakfast: MealPlanMeal(name: breakfast, calories: breakfastKcal, protein: breakfastProtein, carbs: 40, fat: 10, prepMins: 8),
                lunch: MealPlanMeal(name: lunch, calories: lunchKcal, protein: lunchProtein, carbs: 36, fat: 14, prepMins: 12),
                dinner: MealPlanMeal(name: dinner, calories: dinnerKcal, protein: dinnerProtein, carbs: 48, fat: 18, prepMins: 20),
                snack: MealPlanMeal(name: "Fruit", calories: 90, protein: 1, carbs: 22, fat: 0, prepMins: 1)
            ),
            dailyTotals: MealPlanTotals(calories: calories, protein: protein, carbs: 146, fat: 42)
        )
    }

    /// A finished receipt read, with no prices, so Scan shows the haul score.
    static func sampleReceipt() -> ReceiptScanResponse {
        func item(_ name: String, _ category: String, _ protein: Double, _ calories: Double) -> ReceiptScanResponse.Item {
            ReceiptScanResponse.Item(
                name: name,
                quantity: FlexDouble(1),
                unit: nil,
                price: nil,
                category: category,
                nutrition: ReceiptScanResponse.Nutrition(
                    protein: FlexDouble(protein),
                    carbs: nil,
                    fat: nil,
                    calories: FlexDouble(calories)
                )
            )
        }
        return ReceiptScanResponse(
            success: true,
            error: nil,
            items: [
                item("Chicken breast", "meat", 46, 220),
                item("Greek yoghurt", "dairy", 18, 160),
                item("Rolled oats", "grains", 10, 340),
                item("Broccoli", "vegetables", 6, 80),
                item("Eggs", "dairy", 24, 280),
                item("Salmon fillets", "meat", 40, 360),
            ],
            weeklyTotals: ReceiptScanResponse.Totals(
                protein: FlexDouble(144),
                carbs: FlexDouble(90),
                fat: FlexDouble(48),
                calories: FlexDouble(1440)
            ),
            grade: "A",
            shareText: nil
        )
    }
}
