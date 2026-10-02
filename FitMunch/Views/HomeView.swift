import SwiftUI
import SwiftData

/// Today screen with the daily dashboard.
struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel: HomeViewModel
    @ObservedObject private var network = NetworkMonitor.shared
    @State private var showLogMeal = false
    @State private var showPaywall = false
    @State private var freeLimitHits = 0

    init(modelContext: ModelContext) {
        _viewModel = StateObject(wrappedValue: HomeViewModel(modelContext: modelContext))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.six) {
                    OfflineNotice(prominent: true)

                    dateNavigation
                    progressSection
                    summarySection
                    mealsSection
                }
                .padding()
            }
            .scrollClearsTabBar()
            .background(Theme.surface)
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        if viewModel.canLogMeal {
                            showLogMeal = true
                        } else {
                            freeLimitHits += 1
                            showPaywall = true
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                            .symbolRenderingMode(.hierarchical)
                    }
                    .accessibilityIdentifier("today-log-meal")
                    .accessibilityLabel("Log a meal")
                }
            }
            .sensoryFeedback(.warning, trigger: freeLimitHits)
            .sheet(isPresented: $showLogMeal) {
                DetailView(modelContext: modelContext)
            }
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallView()
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(Theme.Radius.large)
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

    private var dateNavigation: some View {
        HStack {
            Button {
                viewModel.previousDay()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.headline)
            }
            .accessibilityLabel("Previous day")

            Spacer()

            VStack {
                Text(viewModel.formattedDate)
                    .font(.title2)
                    .fontWeight(.semibold)

                if viewModel.isToday {
                    Text("Today")
                        .font(.caption)
                        .foregroundStyle(Theme.brandGreen)
                        .padding(.horizontal, Theme.Spacing.two)
                        .padding(.vertical, 2)
                        .background(Theme.brandGreenSoft)
                        .cornerRadius(Theme.Spacing.one)
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
            .accessibilityLabel("Next day")
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(Theme.Radius.medium)
        .sensoryFeedback(.selection, trigger: viewModel.selectedDate)
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.four) {
            Text("Daily Progress")
                .font(.title2)
                .fontWeight(.semibold)

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: Theme.Spacing.four) {
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
                    color: Theme.brandGreen,
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
                    color: .mint,
                    unit: "g"
                )
            }
        }
    }

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.four) {
            Text("Daily Summary")
                .font(.title2)
                .fontWeight(.semibold)

            HStack {
                SummaryCard(
                    title: "Meals",
                    value: viewModel.meals.count,
                    icon: "fork.knife",
                    color: Theme.brandGreen
                )

                SummaryCard(
                    title: "Calories",
                    value: viewModel.totalCalories,
                    icon: "flame",
                    color: .red
                )

                SummaryCard(
                    title: "Remaining",
                    value: max(0, Constants.DefaultGoals.dailyCalories - viewModel.totalCalories),
                    icon: "target",
                    color: Theme.brandGreen
                )
            }
        }
    }

    private var mealsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.four) {
            HStack {
                Text(viewModel.isToday ? "Today's Meals" : "Meals")
                    .font(.title2)
                    .fontWeight(.semibold)

                Spacer()

                if !viewModel.canLogMeal {
                    Text("Free limit reached")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.horizontal, Theme.Spacing.two)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.1))
                        .cornerRadius(Theme.Spacing.one)
                }
            }

            if viewModel.meals.isEmpty && !network.isOnline {
                OfflineNotice(prominent: true)
            } else if viewModel.meals.isEmpty {
                ContentUnavailableView {
                    Label("No meals logged today", systemImage: "fork.knife")
                } description: {
                    Text("Tap + to log your first meal")
                }
            } else {
                ForEach(viewModel.meals) { meal in
                    MealCard(meal: meal) {
                        viewModel.deleteMeal(meal)
                    }
                }
            }
        }
    }
}

/// Progress ring for nutrient tracking. The arc starts at 0 unless Reduce Motion is on.
private struct ProgressRing: View {
    let title: String
    let value: Int
    let goal: Int
    let progress: Double
    let color: Color
    let unit: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    init(title: String, value: Int, goal: Int, progress: Double, color: Color, unit: String = "") {
        self.title = title
        self.value = value
        self.goal = goal
        self.progress = progress
        self.color = color
        self.unit = unit
    }

    private var spoken: String {
        if unit == "g" {
            return "\(title) \(value) of \(goal) grams"
        }
        return "\(title) \(value) of \(goal)"
    }

    var body: some View {
        VStack(spacing: Theme.Spacing.two) {
            ZStack {
                Circle()
                    .stroke(color.opacity(0.2), lineWidth: 8)
                    .frame(width: 80, height: 80)

                Circle()
                    .trim(from: 0, to: shown)
                    .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 80, height: 80)
                    .rotationEffect(.degrees(-90))

                VStack {
                    MacroNumber(value: value, style: .headline)
                    if !unit.isEmpty {
                        Text(unit)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("\(Int(progress * 100))%")
                .font(.caption2.monospacedDigit())
                .fontWeight(.medium)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(color.opacity(0.1))
                .foregroundStyle(color)
                .cornerRadius(Theme.Spacing.one)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken)
        .onAppear { apply(progress) }
        .onChange(of: progress) { _, newValue in apply(newValue) }
    }

    private func apply(_ newValue: Double) {
        if reduceMotion || ScreenshotLaunch.isActive {
            shown = newValue
        } else {
            withAnimation(.spring(duration: 0.8)) {
                shown = newValue
            }
        }
    }
}

/// Summary card for quick stats.
private struct SummaryCard: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: Theme.Spacing.two) {
            Image(systemName: icon)
                .font(.title2)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(color)

            MacroNumber(value: value, style: .title2)

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(Theme.Radius.medium)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(value)")
    }
}

/// Meal card for displaying a meal.
private struct MealCard: View {
    let meal: Meal
    let onDelete: () -> Void
    @State private var showDeleteAlert = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.three) {
            HStack {
                VStack(alignment: .leading, spacing: Theme.Spacing.one) {
                    Text(meal.name)
                        .font(.headline)
                    Text(Constants.timeFormatter.string(from: meal.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button(role: .destructive) {
                    showDeleteAlert = true
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Delete \(meal.name)")
            }

            HStack {
                NutritionBadge(value: meal.totalCalories, unit: "cal", color: .red)
                NutritionBadge(value: meal.totalProtein, unit: "P", color: Theme.brandGreen)
                NutritionBadge(value: meal.totalCarbs, unit: "C", color: .orange)
                NutritionBadge(value: meal.totalFats, unit: "F", color: .mint)

                Spacer()

                Text("\(meal.foodItems.count) items")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(Theme.Radius.medium)
        .alert("Delete Meal", isPresented: $showDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive, action: onDelete)
        } message: {
            Text("Are you sure you want to delete this meal?")
        }
    }
}

/// Nutrition badge for meal cards.
private struct NutritionBadge: View {
    let value: Int
    let unit: String
    let color: Color

    var body: some View {
        HStack(spacing: 2) {
            Text("\(value)")
                .font(.caption.monospacedDigit())
                .fontWeight(.semibold)
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Theme.Spacing.two)
        .padding(.vertical, Theme.Spacing.one)
        .background(color.opacity(0.1))
        .foregroundStyle(color)
        .cornerRadius(Theme.Spacing.one)
    }
}

#Preview {
    HomeView(modelContext: try! ModelContainer(for: Meal.self, UserProfile.self, FoodItem.self).mainContext)
}
