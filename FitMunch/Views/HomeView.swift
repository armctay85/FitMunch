import SwiftUI
import SwiftData
import UIKit

/// Today screen with the daily dashboard.
struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel: HomeViewModel
    @State private var showLogMeal = false
    @State private var showPaywall = false
    @State private var freeLimitHits = 0
    /// How far the floating tab buttons sit above the bottom safe area.
    @State private var tabClearance: CGFloat = 0
    /// Container height. Daily Summary tightens only when this is under 900pt.
    @State private var availableHeight: CGFloat = 0
    @State private var regularSummaryHeight: CGFloat = 0
    @State private var compactSummaryHeight: CGFloat = 0
    @State private var didLogSummaryHeights = false

    init(modelContext: ModelContext) {
        _viewModel = StateObject(wrappedValue: HomeViewModel(modelContext: modelContext))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.one) {
                    OfflineNotice()

                    dateNavigation
                    if viewModel.isLoading {
                        LoadingSkeleton(rows: 4, label: "Loading today", identifier: "today-loading")
                    } else if showsEmptyMeals {
                        mealsSection
                    } else {
                        progressSection
                        summarySection(compact: summaryIsCompact)
                        mealsSection
                    }
                }
                .padding()
                .padding(.top, 14)
                .padding(.bottom, Theme.Spacing.eight)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: tabClearance)
                    .accessibilityHidden(true)
            }
            .background {
                HomeTabClearanceReader { measured in
                    guard abs(measured - tabClearance) > 0.5 else { return }
                    tabClearance = measured
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .background(Theme.surface)
            .navigationTitle("Today")
            // The date row scrolls under this bar once Dinner sits on the tab
            // bar. An opaque bar hides that date. iOS 26 glass still shows it
            // through toolbarBackground, so the live bar is set opaque too.
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .background {
                OpaqueNavigationBar()
            }
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
                    .accessibilityLabel("Log a meal")
                    .uniqueButtonIdentifier("today-log-meal")
                }
            }
            .sensoryFeedback(.warning, trigger: freeLimitHits)
            .sheet(isPresented: $showLogMeal, onDismiss: {
                viewModel.loadMealsForSelectedDate()
            }) {
                DetailView(modelContext: modelContext)
            }
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallView()
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
        .background {
            WindowHeightReader { height in
                guard abs(height - availableHeight) > 0.5 else { return }
                availableHeight = height
            }
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    /// Window height, not the device name. The scroll view is shorter than the
/// screen because the navigation bar sits above it.
private struct WindowHeightReader: UIViewRepresentable {
    var onHeight: (CGFloat) -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        let report = onHeight
        DispatchQueue.main.async {
            let height = uiView.window?.bounds.height ?? 0
            guard height > 1 else { return }
            report(height)
        }
    }
}

/// Zero rings were pushing "No meals logged today" below the fold.
    private var showsEmptyMeals: Bool {
        viewModel.meals.isEmpty && !viewModel.isLoading
    }

    private var dateNavigation: some View {
        HStack {
            Button {
                viewModel.previousDay()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Previous day")

            Spacer()

            if !viewModel.isToday {
                Text(viewModel.formattedDate)
                    .font(.title2)
                    .fontWeight(.semibold)
            }

            Spacer()

            Button {
                viewModel.nextDay()
            } label: {
                Image(systemName: "chevron.right")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
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

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Spacing.two), count: 4), spacing: Theme.Spacing.two) {
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
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("today-rings")
        }
    }

    /// Short phones (under 900pt of container height) use the compact row.
    /// The other variant is measured at the same width and kept out of the layout.
    private var summaryIsCompact: Bool {
        availableHeight > 0 && availableHeight < 900
    }

    private func summarySection(compact: Bool) -> some View {
        summaryBody(compact: compact, publishHeights: true)
            .background(summaryHeightReader(compact: compact))
            .background {
                // The other variant is measured at this width. A zero-height
                // scroll view gives it its ideal height without changing the page.
                ScrollView {
                    summaryBody(compact: !compact, publishHeights: false)
                        .background(summaryHeightReader(compact: !compact))
                }
                .scrollDisabled(true)
                .frame(height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("daily-summary")
            .accessibilityLabel("Daily Summary")
            .accessibilityValue(summaryHeightValue)
    }

    private var summaryHeightValue: String {
        let regular = Int(regularSummaryHeight.rounded())
        let compact = Int(compactSummaryHeight.rounded())
        return "regular=\(regular) compact=\(compact)"
    }

    private func summaryBody(compact: Bool, publishHeights: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? Theme.Spacing.two : Theme.Spacing.four) {
            Text("Daily Summary")
                .font(.title2)
                .fontWeight(.semibold)
                .modifier(PublishSummaryHeights(enabled: publishHeights, value: summaryHeightValue))

            HStack {
                SummaryCard(
                    title: "Meals",
                    value: viewModel.meals.count,
                    icon: "fork.knife",
                    color: Theme.brandGreen,
                    compact: compact
                )
                SummaryCard(
                    title: "Calories",
                    value: viewModel.totalCalories,
                    icon: "flame",
                    color: .red,
                    compact: compact
                )
                SummaryCard(
                    title: "Remaining",
                    value: max(0, Constants.DefaultGoals.dailyCalories - viewModel.totalCalories),
                    icon: "target",
                    color: Theme.brandGreen,
                    compact: compact
                )
            }
        }
    }

    private func summaryHeightReader(compact: Bool) -> some View {
        GeometryReader { proxy in
            Color.clear
                .onAppear { recordSummaryHeight(compact: compact, height: proxy.size.height) }
                .onChange(of: proxy.size.height) { _, height in
                    recordSummaryHeight(compact: compact, height: height)
                }
        }
    }

    private func recordSummaryHeight(compact: Bool, height: CGFloat) {
        guard height > 1 else { return }
        if compact {
            guard abs(compactSummaryHeight - height) > 0.5 else { return }
            compactSummaryHeight = height
        } else {
            guard abs(regularSummaryHeight - height) > 0.5 else { return }
            regularSummaryHeight = height
        }
        guard !didLogSummaryHeights, regularSummaryHeight > 1, compactSummaryHeight > 1 else { return }
        didLogSummaryHeights = true
        NSLog(
            "SUMMARY_HEIGHT regular=%.1f compact=%.1f drop=%.1f available=%.1f",
            regularSummaryHeight,
            compactSummaryHeight,
            regularSummaryHeight - compactSummaryHeight,
            availableHeight
        )
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

            if viewModel.meals.isEmpty {
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
        VStack(spacing: Theme.Spacing.one) {
            ZStack {
                Circle()
                    .stroke(color.opacity(0.2), lineWidth: 6)
                    .frame(width: 64, height: 64)

                Circle()
                    .trim(from: 0, to: shown)
                    .stroke(color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .frame(width: 64, height: 64)
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 0) {
                    MacroNumber(value: value, style: .caption)
                    if !unit.isEmpty {
                        Text(unit)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

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
private struct PublishSummaryHeights: ViewModifier {
    var enabled: Bool
    var value: String

    func body(content: Content) -> some View {
        if enabled {
            content
                .accessibilityIdentifier("daily-summary-title")
                .accessibilityValue(value)
        } else {
            content
        }
    }
}

private struct SummaryCard: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color
    var compact: Bool = false

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
        .padding(.horizontal, compact ? Theme.Spacing.two : Theme.Spacing.four)
        .padding(.vertical, compact ? 0 : Theme.Spacing.four)
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
                        .accessibilityIdentifier("today-meal-name")
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
                NutritionBadge(
                    value: meal.totalCalories,
                    unit: "cal",
                    color: .red,
                    identifier: "today-meal-calories"
                )
                NutritionBadge(value: meal.totalProtein, unit: "P", color: Theme.brandGreen)
                NutritionBadge(value: meal.totalCarbs, unit: "C", color: .orange)
                NutritionBadge(value: meal.totalFats, unit: "F", color: .mint)

                Spacer()

                Text(MealItemCount.label(for: meal.foodItems.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(Theme.Radius.medium)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today-meal-card")
        .background {
            MealCardFrameMarker()
        }
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
    var identifier: String? = nil

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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(value)")
        .modifier(MealBadgeID(identifier))
    }
}

private struct MealBadgeID: ViewModifier {
    let identifier: String?

    init(_ identifier: String?) {
        self.identifier = identifier
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if let identifier {
            content.accessibilityIdentifier(identifier)
        } else {
            content
        }
    }
}

/// Forces the navigation bar to an opaque surface. The iOS 26 scroll-edge
/// material leaves the date readable behind the Today title.
private struct OpaqueNavigationBar: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ uiViewController: Controller, context: Context) {
        uiViewController.apply()
    }

    final class Controller: UIViewController {
        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            apply()
        }

        func apply() {
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = UIColor(named: "Surface") ?? .systemBackground
            appearance.shadowColor = .clear
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let bars = Self.navigationBars(from: self)
                for bar in bars {
                    bar.isTranslucent = false
                    bar.standardAppearance = appearance
                    bar.scrollEdgeAppearance = appearance
                    bar.compactAppearance = appearance
                }
            }
        }

        private static func navigationBars(from controller: UIViewController) -> [UINavigationBar] {
            var found: [UINavigationBar] = []
            if let bar = controller.navigationController?.navigationBar {
                found.append(bar)
            }
            guard let root = controller.view.window?.rootViewController else { return found }
            func walk(_ candidate: UIViewController) {
                if let nav = candidate as? UINavigationController {
                    found.append(nav.navigationBar)
                }
                for child in candidate.children {
                    walk(child)
                }
            }
            walk(root)
            return found
        }
    }
}

#Preview {
    HomeView(modelContext: try! ModelContainer(for: Meal.self, UserProfile.self, FoodItem.self).mainContext)
}
