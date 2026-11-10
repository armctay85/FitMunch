import SwiftUI
import SwiftData
import UIKit

private struct TodayScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

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
    @State private var homeScrolled = false
    @State private var todayVisible = false

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
                        loadingToday
                    } else if showsEmptyMeals {
                        mealsSection
                    } else {
                        progressSection
                        summarySection(compact: summaryIsCompact)
                        mealsSection
                    }
                }
                // Breakfast, Lunch, and Dinner rest above the tab bar on 6.5, 6.7,
                // and 6.9 before any drag. The page uses tighter vertical spacing
                // and the same type sizes, so no meal is hidden.
                .padding()
                .padding(.bottom, Theme.Spacing.eight)
                .background(alignment: .top) {
                    GeometryReader { proxy in
                        Color.clear
                            .preference(
                                key: TodayScrollOffsetKey.self,
                                value: proxy.frame(in: .named("today-scroll")).minY
                            )
                    }
                    .frame(height: 0)
                    .accessibilityHidden(true)
                }
            }
            .coordinateSpace(name: "today-scroll")
            .onPreferenceChange(TodayScrollOffsetKey.self) { offset in
                let next = offset < -8
                if next != homeScrolled { homeScrolled = next }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: tabClearance + 16)
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
            .toolbarBackground(Theme.fmBackground, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .overlay(alignment: .top) {
                if homeScrolled {
                    Rectangle()
                        .fill(Theme.fmSeparator)
                        .frame(height: 0.5)
                        .accessibilityHidden(true)
                }
            }
            .background {
                OpaqueNavigationBar()
            }
            .background {
                PageMarginBar(leading: 16)
                    .frame(width: 0, height: 0)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
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
        .background {
            // 56pt circle, 8pt below the top safe area. The toolbar clipped it flat.
            LogMealButtonHost(
                visible: todayVisible && !showLogMeal && !showPaywall,
                onTap: {
                    if viewModel.canLogMeal {
                        showLogMeal = true
                    } else {
                        freeLimitHits += 1
                        showPaywall = true
                    }
                }
            )
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .onAppear { todayVisible = true }
        .onDisappear { todayVisible = false }
    }

    /// Window-level 56pt circle. A toolbar item is clipped by the navigation bar.
    private struct LogMealButtonHost: UIViewRepresentable {
        var visible: Bool
        var onTap: () -> Void

        func makeUIView(context: Context) -> LogMealButtonAnchor {
            let view = LogMealButtonAnchor()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
            view.isAccessibilityElement = false
            return view
        }

        func updateUIView(_ uiView: LogMealButtonAnchor, context: Context) {
            uiView.onTap = onTap
            uiView.visible = visible
            uiView.sync()
        }

        static func dismantleUIView(_ uiView: LogMealButtonAnchor, coordinator: ()) {
            uiView.removeButton()
        }
    }

    /// Window height, not the device name. The scroll view is shorter than the
/// screen because the navigation bar sits above it.
private final class LogMealButtonAnchor: UIView {
    var onTap: (() -> Void)?
    var visible = false
    private let button = UIButton(type: .custom)
    private let diameter: CGFloat = 56

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        let mark = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold))
        button.setImage(mark, for: .normal)
        button.tintColor = .white
        button.backgroundColor = UIColor(red: 21.0 / 255.0, green: 122.0 / 255.0, blue: 60.0 / 255.0, alpha: 1)
        button.layer.cornerRadius = diameter / 2
        button.layer.masksToBounds = true
        button.accessibilityLabel = "Log a meal"
        button.accessibilityIdentifier = "today-log-meal"
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        sync()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        sync()
    }

    func sync() {
        guard visible, let window = window ?? superview?.window else {
            button.removeFromSuperview()
            return
        }
        if button.superview !== window {
            window.addSubview(button)
        }
        let top = window.safeAreaInsets.top + 8
        let x = window.bounds.width - 16 - diameter
        button.frame = CGRect(x: x, y: top, width: diameter, height: diameter)
        button.layer.cornerRadius = diameter / 2
        window.bringSubviewToFront(button)
    }

    func removeButton() {
        button.removeFromSuperview()
    }

    @objc private func tapped() {
        onTap?()
    }
}

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

            Text(viewModel.formattedDate)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.fmSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

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
        // The chevrons keep their 44pt targets. Only the card's vertical padding is tighter.
        .padding(.horizontal)
        .padding(.vertical, Theme.Spacing.one)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(Theme.Radius.medium)
        .sensoryFeedback(.selection, trigger: viewModel.selectedDate)
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            Text("Daily Progress")
                .font(.title2)
                .fontWeight(.semibold)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Spacing.two), count: 4), spacing: Theme.Spacing.two) {
                ProgressRing(
                    title: "Calories",
                    value: viewModel.totalCalories,
                    goal: Constants.DefaultGoals.dailyCalories,
                    progress: viewModel.progress(for: .calories, goal: Constants.DefaultGoals.dailyCalories),
                    color: Theme.fmBrand
                )

                ProgressRing(
                    title: "Protein",
                    value: viewModel.totalProtein,
                    goal: Constants.DefaultGoals.dailyProtein,
                    progress: viewModel.progress(for: .protein, goal: Constants.DefaultGoals.dailyProtein),
                    color: Color(red: 47.0 / 255, green: 111.0 / 255, blue: 222.0 / 255),
                    unit: "g"
                )

                ProgressRing(
                    title: "Carbs",
                    value: viewModel.totalCarbs,
                    goal: Constants.DefaultGoals.dailyCarbs,
                    progress: viewModel.progress(for: .carbs, goal: Constants.DefaultGoals.dailyCarbs),
                    color: Color(red: 224.0 / 255, green: 138.0 / 255, blue: 0),
                    unit: "g"
                )

                ProgressRing(
                    title: "Fats",
                    value: viewModel.totalFats,
                    goal: Constants.DefaultGoals.dailyFats,
                    progress: viewModel.progress(for: .fats, goal: Constants.DefaultGoals.dailyFats),
                    color: Color(red: 194.0 / 255, green: 65.0 / 255, blue: 122.0 / 255),
                    unit: "g"
                )
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("today-rings")
        }
    }

    /// Rings, summary tiles, and meal rows in the loaded frames. No figures.
    private var loadingToday: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.one) {
            loadingRings
            loadingSummary
            loadingMeals
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Loading today")
        .accessibilityIdentifier("today-loading")
    }

    private var loadingRings: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            Text("Daily Progress")
                .font(.title2)
                .fontWeight(.semibold)
            HStack(spacing: Theme.Spacing.two) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(spacing: Theme.Spacing.one) {
                        Circle()
                            .fill(SkeletonFill.color)
                            .frame(width: 64, height: 64)
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(SkeletonFill.color)
                            .frame(width: 44, height: 10)
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(SkeletonFill.color)
                            .frame(width: 28, height: 14)
                    }
                    .frame(maxWidth: .infinity)
                    .modifier(SkeletonShimmer(active: true))
                }
            }
        }
    }

    private var loadingSummary: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.four) {
            Text("Daily Summary")
                .font(.title2)
                .fontWeight(.semibold)
            HStack(spacing: Theme.Spacing.two) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                        .fill(SkeletonFill.color)
                        .frame(maxWidth: .infinity)
                        .frame(height: summaryIsCompact ? 72 : 112)
                        .modifier(SkeletonShimmer(active: true))
                }
            }
        }
    }

    /// Same card pitch as a logged meal, with no counts and no percent text.
    private var loadingMeals: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            Text("Today's Meals")
                .font(.title2)
                .fontWeight(.semibold)
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                    .fill(SkeletonFill.color)
                    .frame(height: 76)
                    .modifier(SkeletonShimmer(active: true))
            }
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
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
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
                VStack(spacing: Theme.Spacing.three) {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 32))
                        .foregroundStyle(Theme.fmBrand)
                    Text("No meals logged today")
                        .font(.headline.weight(.semibold))
                    Text("Log your first meal to see your day.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.fmSecondary)
                        .multilineTextAlignment(.center)
                    Button("Log a meal") {
                        showLogMeal = true
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(height: 50)
                }
                .padding(20)
                .frame(maxWidth: .infinity)
                .background(Theme.fmSurface)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            HStack(alignment: .center) {
                // Name and time share one line so three cards rest above the tab bar.
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.two) {
                    Text(meal.name)
                        .font(.headline)
                        .lineLimit(1)
                        .accessibilityIdentifier("today-meal-name")
                    Text(Constants.timeFormatter.string(from: meal.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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
                    .font(.footnote)
                    .foregroundStyle(Theme.fmSecondary)
            }
        }
        .padding(.horizontal, Theme.Spacing.four)
        .padding(.vertical, Theme.Spacing.three)
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

private enum SkeletonFill {
    static let color = Color(red: 230.0 / 255, green: 234.0 / 255, blue: 230.0 / 255)
}

/// 1.2s shimmer. Reduce Motion and screenshot capture stay still.
private struct SkeletonShimmer: ViewModifier {
    var active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content.overlay {
            if active, !reduceMotion, !ScreenshotLaunch.isActive {
                GeometryReader { proxy in
                    LinearGradient(
                        colors: [Color.white.opacity(0), Color.white.opacity(0.55), Color.white.opacity(0)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: proxy.size.width * 0.55)
                    .offset(x: phase * proxy.size.width)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .onAppear { start() }
        .onChange(of: reduceMotion) { _, _ in start() }
    }

    private func start() {
        guard active, !reduceMotion, !ScreenshotLaunch.isActive else { return }
        phase = -1
        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
            phase = 1.6
        }
    }
}

/// Large-title and card share one 16pt leading margin. Does not change row height.
private struct PageMarginBar: UIViewRepresentable {
    var leading: CGFloat

    func makeUIView(context: Context) -> MarginProbe {
        let view = MarginProbe()
        view.leading = leading
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: MarginProbe, context: Context) {
        uiView.leading = leading
        uiView.apply()
    }

    final class MarginProbe: UIView {
        var leading: CGFloat = 16

        override func didMoveToWindow() {
            super.didMoveToWindow()
            apply()
        }

        func apply() {
            let leading = leading
            DispatchQueue.main.async { [weak self] in
                guard let self, let window = self.window else { return }
                guard let bar = Self.findBar(in: window) else { return }
                bar.directionalLayoutMargins.leading = leading
                bar.directionalLayoutMargins.trailing = leading
                if bar.layoutMargins.left != leading {
                    bar.layoutMargins.left = leading
                    bar.layoutMargins.right = leading
                }
                bar.clipsToBounds = false
                bar.layer.masksToBounds = false
                var parent = bar.superview
                var levels = 0
                while let view = parent, levels < 3 {
                    view.clipsToBounds = false
                    view.layer.masksToBounds = false
                    parent = view.superview
                    levels += 1
                }
            }
        }

        private static func findBar(in view: UIView) -> UINavigationBar? {
            if let bar = view as? UINavigationBar { return bar }
            for child in view.subviews {
                if let found = findBar(in: child) { return found }
            }
            return nil
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
