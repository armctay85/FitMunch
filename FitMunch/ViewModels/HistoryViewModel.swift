import Foundation
import SwiftData
import SwiftUI

/// ViewModel for the history/progress screen
@MainActor
class HistoryViewModel: ObservableObject {
    @Published var selectedDateRange: DateRange = .week
    @Published var startDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @Published var endDate: Date = Date()
    @Published var meals: [Meal] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var chartData: [ChartDataPoint] = []
    
    private let modelContext: ModelContext
    private let premiumManager = PremiumManager.shared
    
    /// Initialize with model context
    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadMealsForDateRange()
        generateChartData()
    }
    
    /// Load meals for the selected date range
    func loadMealsForDateRange() {
        isLoading = true
        defer { isLoading = false }
        
        // Check if user has access to history
        guard premiumManager.isFeatureAvailableInFreeTier(feature: .historyAccess) else {
            errorMessage = "Upgrade to premium to access full history"
            meals = []
            return
        }
        
        do {
            let descriptor = FetchDescriptor<Meal>(
                predicate: #Predicate { meal in
                    meal.date >= startDate && meal.date <= endDate
                },
                sortBy: [SortDescriptor(\.date, order: .reverse)]
            )
            
            meals = try modelContext.fetch(descriptor)
            errorMessage = nil
        } catch {
            errorMessage = "Failed to load history: \(error.localizedDescription)"
            print("Error loading history: \(error)")
        }
    }
    
    /// Generate chart data for visualization
    func generateChartData() {
        guard !meals.isEmpty else {
            chartData = []
            return
        }
        
        // Group meals by date
        let groupedMeals = Dictionary(grouping: meals) { meal in
            Calendar.current.startOfDay(for: meal.date)
        }
        
        // Create chart data points
        chartData = groupedMeals.map { date, meals in
            let totalCalories = meals.reduce(0) { $0 + $1.totalCalories }
            let totalProtein = meals.reduce(0) { $0 + $1.totalProtein }
            let totalCarbs = meals.reduce(0) { $0 + $1.totalCarbs }
            let totalFats = meals.reduce(0) { $0 + $1.totalFats }
            
            return ChartDataPoint(
                date: date,
                calories: totalCalories,
                protein: totalProtein,
                carbs: totalCarbs,
                fats: totalFats,
                mealCount: meals.count
            )
        }.sorted { $0.date < $1.date }
    }
    
    /// Update date range based on selection
    func updateDateRange() {
        let calendar = Calendar.current
        let now = Date()
        
        switch selectedDateRange {
        case .week:
            startDate = calendar.date(byAdding: .day, value: -7, to: now) ?? now
            endDate = now
        case .month:
            startDate = calendar.date(byAdding: .month, value: -1, to: now) ?? now
            endDate = now
        case .threeMonths:
            startDate = calendar.date(byAdding: .month, value: -3, to: now) ?? now
            endDate = now
        case .custom:
            // Custom range already set by user
            break
        }
        
        loadMealsForDateRange()
        generateChartData()
    }
    
    /// Calculate averages for the selected date range
    var averages: (calories: Double, protein: Double, carbs: Double, fats: Double) {
        guard !meals.isEmpty else { return (0, 0, 0, 0) }
        
        let totalDays = max(1, Calendar.current.dateComponents([.day], from: startDate, to: endDate).day ?? 1)
        let uniqueDays = Set(meals.map { Calendar.current.startOfDay(for: $0.date) }).count
        
        let totalCalories = meals.reduce(0) { $0 + $1.totalCalories }
        let totalProtein = meals.reduce(0) { $0 + $1.totalProtein }
        let totalCarbs = meals.reduce(0) { $0 + $1.totalCarbs }
        let totalFats = meals.reduce(0) { $0 + $1.totalFats }
        
        return (
            calories: Double(totalCalories) / Double(uniqueDays),
            protein: Double(totalProtein) / Double(uniqueDays),
            carbs: Double(totalCarbs) / Double(uniqueDays),
            fats: Double(totalFats) / Double(uniqueDays)
        )
    }
    
    /// Check if user has access to premium features
    var hasPremiumAccess: Bool {
        return premiumManager.isPremium
    }
    
    /// Export data (premium feature)
    func exportData() async -> String? {
        guard premiumManager.isPremium else {
            errorMessage = "Upgrade to premium to export data"
            return nil
        }
        
        isLoading = true
        defer { isLoading = false }
        
        // Generate CSV data
        var csv = "Date,Meal Name,Calories,Protein (g),Carbs (g),Fats (g)\n"
        
        for meal in meals.sorted(by: { $0.date < $1.date }) {
            let dateString = Constants.dateFormatter.string(from: meal.date)
            csv += "\(dateString),\(meal.name),\(meal.totalCalories),\(meal.totalProtein),\(meal.totalCarbs),\(meal.totalFats)\n"
        }
        
        return csv
    }
    
    /// Format date range for display
    var formattedDateRange: String {
        let formatter = Constants.dateFormatter
        return "\(formatter.string(from: startDate)) - \(formatter.string(from: endDate))"
    }
}

/// Date range options
enum DateRange: String, CaseIterable {
    case week = "Week"
    case month = "Month"
    case threeMonths = "3 Months"
    case custom = "Custom"
}

/// Chart data point for visualization
struct ChartDataPoint: Identifiable {
    let id = UUID()
    let date: Date
    let calories: Int
    let protein: Int
    let carbs: Int
    let fats: Int
    let mealCount: Int
    
    var formattedDate: String {
        Constants.dateFormatter.string(from: date)
    }
}