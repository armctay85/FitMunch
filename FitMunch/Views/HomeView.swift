import SwiftUI
import SwiftData

/// Home screen with daily dashboard
struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel: HomeViewModel
    @State private var showLogMeal = false
    @State private var showPaywall = false
    
    init(modelContext: ModelContext) {
        _viewModel = StateObject(wrappedValue: HomeViewModel(modelContext: modelContext))
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Date navigation
                    dateNavigation
                    
                    // Progress rings
                    progressSection
                    
                    // Daily summary
                    summarySection
                    
                    // Today's meals
                    mealsSection
                }
                .padding()
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        if viewModel.canLogMeal {
                            showLogMeal = true
                        } else {
                            showPaywall = true
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                }
            }
            .sheet(isPresented: $showLogMeal) {
                DetailView(modelContext: modelContext)
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(16)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
            .refreshable {
                viewModel.loadMealsForSelectedDate()
            }
        }
    }
    
    /// Date navigation header
    private var dateNavigation: some View {
        HStack {
            Button {
                viewModel.previousDay()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.headline)
            }
            
            Spacer()
            
            VStack {
                Text(viewModel.formattedDate)
                    .font(.title2)
                    .fontWeight(.semibold)
                
                if viewModel.isToday {
                    Text("Today")
                        .font(.caption)
                        .foregroundColor(.blue)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(4)
                }
            }
            
            Spacer()
            
            Button {
                viewModel.nextDay()
            } label: {
                Image(systemName: "chevron.right")
                    .font(.headline)
            }
            .disabled(viewModel.isToday)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
    
    /// Progress rings section
    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily Progress")
                .font(.title2)
                .fontWeight(.semibold)
            
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 16) {
                ProgressRing(
                    title: "Calories",
                    value: viewModel.totalCalories,
                    goal: Constants.DefaultGoals.dailyCalories,
                    progress: viewModel.progress(for: .calories, goal: Constants.DefaultGoals.dailyCalories),
                    color: .red
                )
                
                ProgressRing(
                    title: "Protein",
                    value: viewModel.totalProtein,
                    goal: Constants.DefaultGoals.dailyProtein,
                    progress: viewModel.progress(for: .protein, goal: Constants.DefaultGoals.dailyProtein),
                    color: .blue,
                    unit: "g"
                )
                
                ProgressRing(
                    title: "Carbs",
                    value: viewModel.totalCarbs,
                    goal: Constants.DefaultGoals.dailyCarbs,
                    progress: viewModel.progress(for: .carbs, goal: Constants.DefaultGoals.dailyCarbs),
                    color: .orange,
                    unit: "g"
                )
                
                ProgressRing(
                    title: "Fats",
                    value: viewModel.totalFats,
                    goal: Constants.DefaultGoals.dailyFats,
                    progress: viewModel.progress(for: .fats, goal: Constants.DefaultGoals.dailyFats),
                    color: .green,
                    unit: "g"
                )
            }
        }
    }
    
    /// Daily summary section
    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily Summary")
                .font(.title2)
                .fontWeight(.semibold)
            
            HStack {
                SummaryCard(
                    title: "Meals",
                    value: "\(viewModel.meals.count)",
                    icon: "fork.knife",
                    color: .blue
                )
                
                SummaryCard(
                    title: "Calories",
                    value: "\(viewModel.totalCalories)",
                    icon: "flame",
                    color: .red
                )
                
                SummaryCard(
                    title: "Remaining",
                    value: "\(max(0, Constants.DefaultGoals.dailyCalories - viewModel.totalCalories))",
                    icon: "target",
                    color: .green
                )
            }
        }
    }
    
    /// Today's meals section
    private var mealsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Today's Meals")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Spacer()
                
                if !viewModel.canLogMeal {
                    Text("Free limit reached")
                        .font(.caption)
                        .foregroundColor(.orange)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.1))
                        .cornerRadius(4)
                }
            }
            
            if viewModel.meals.isEmpty {
                emptyState
            } else {
                ForEach(viewModel.meals) { meal in
                    MealCard(meal: meal) {
                        viewModel.deleteMeal(meal)
                    }
                }
            }
        }
    }
    
    /// Empty state when no meals logged
    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "fork.knife.circle")
                .font(.system(size: 60))
                .foregroundColor(.gray.opacity(0.5))
            
            Text("No meals logged today")
                .font(.headline)
                .foregroundColor(.secondary)
            
            Text("Tap the + button to log your first meal")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
}

/// Progress ring for nutrient tracking
private struct ProgressRing: View {
    let title: String
    let value: Int
    let goal: Int
    let progress: Double
    let color: Color
    let unit: String
    
    init(title: String, value: Int, goal: Int, progress: Double, color: Color, unit: String = "") {
        self.title = title
        self.value = value
        self.goal = goal
        self.progress = progress
        self.color = color
        self.unit = unit
    }
    
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .stroke(color.opacity(0.2), lineWidth: 8)
                    .frame(width: 80, height: 80)
                
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 80, height: 80)
                    .rotationEffect(.degrees(-90))
                
                VStack {
                    Text("\(value)")
                        .font(.headline)
                        .fontWeight(.bold)
                    Text(unit)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            
            Text("\(Int(progress * 100))%")
                .font(.caption2)
                .fontWeight(.medium)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(color.opacity(0.1))
                .foregroundColor(color)
                .cornerRadius(4)
        }
    }
}

/// Summary card for quick stats
private struct SummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
            
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(12)
    }
}

/// Meal card for displaying a meal
private struct MealCard: View {
    let meal: Meal
    let onDelete: () -> Void
    @State private var showDeleteAlert = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(meal.name)
                        .font(.headline)
                    Text(Constants.timeFormatter.string(from: meal.date))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Button(role: .destructive) {
                    showDeleteAlert = true
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                        .foregroundColor(.red)
                }
                .buttonStyle(.borderless)
            }
            
            HStack {
                NutritionBadge(value: meal.totalCalories, unit: "cal", color: .red)
                NutritionBadge(value: meal.totalProtein, unit: "P", color: .blue)
                NutritionBadge(value: meal.totalCarbs, unit: "C", color: .orange)
                NutritionBadge(value: meal.totalFats, unit: "F", color: .green)
                
                Spacer()
                
                Text("\(meal.foodItems.count) items")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
        .alert("Delete Meal", isPresented: $showDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive, action: onDelete)
        } message: {
            Text("Are you sure you want to delete this meal?")
        }
    }
}

/// Nutrition badge for meal cards
private struct NutritionBadge: View {
    let value: Int
    let unit: String
    let color: Color
    
    var body: some View {
        HStack(spacing: 2) {
            Text("\(value)")
                .font(.caption)
                .fontWeight(.semibold)
            Text(unit)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1))
        .foregroundColor(color)
        .cornerRadius(4)
    }
}

#Preview {
    HomeView(modelContext: try! ModelContainer(for: Meal.self, UserProfile.self, FoodItem.self).mainContext)
}