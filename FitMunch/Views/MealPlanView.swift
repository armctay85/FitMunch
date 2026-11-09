import SwiftUI

/// Named space of the week's scroll view. Row frames in it are measured
/// against the visible height so a row is never left half under the fold.
private let planScrollSpace = "plan-scroll"

/// AI meal planner. Same `/api/meal-plan/generate` rail as the web app.
struct MealPlanView: View {
    var embedded: Bool = false

    @State private var calories = "2000"
    @State private var protein = "150"
    @State private var goal = "general_fitness"
    @State private var plan: MealPlanPayload?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showPaywall = false
    @State private var plansGenerated = 0
    @State private var freeLimitHits = 0
    @State private var showConsent = false
    /// Visible height of the week's scroll view, which ends at the Generate bar.
    @State private var planViewportHeight: CGFloat = 0
    @EnvironmentObject private var auth: AuthManager
    @ObservedObject private var consent = AIDataConsent.shared

    private let goals: [(id: String, label: String)] = [
        ("general_fitness", "General"),
        ("lose_weight", "Cut"),
        ("muscle_gain", "Build"),
        ("maintain", "Maintain"),
    ]

    var body: some View {
        Group {
            if embedded {
                planContent
            } else {
                NavigationStack {
                    planContent
                        .navigationTitle("Plan")
                }
            }
        }
    }

    private var planContent: some View {
        VStack(spacing: 0) {
            targetsHeader
            planScroll
            generateBar
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.surface)
        .sensoryFeedback(.selection, trigger: goal)
        .sensoryFeedback(.success, trigger: plansGenerated)
        .sensoryFeedback(.warning, trigger: freeLimitHits)
        .fullScreenCover(isPresented: $showPaywall) {
            PaywallView()
        }
        .sheet(isPresented: $showConsent) {
            AIDataConsentSheet(
                onAllow: {
                    showConsent = false
                    consent.allow(userId: auth.user?.id)
                    Task { await generate() }
                },
                onNotNow: {
                    showConsent = false
                    consent.deny(userId: auth.user?.id)
                    errorMessage = AIConsentCopy.planBlocked
                }
            )
        }
        .onAppear {
            if ScreenshotLaunch.isActive && plan == nil {
                plan = ScreenshotLaunch.mealPlan()
            }
            if AuditLaunch.isPlanLoading {
                isLoading = true
            }
        }
    }

    /// Generate is a sibling under the scroll view, so the week ends at the
    /// bar's top edge and no row can sit under it.
    /// A generated plan parks Monday dinner at the bottom of that scroll view.
    /// Store and audit launches stay at the top so plan.summary is not cut
    /// under the targets header on the 6.9-inch shot.
    private var planScroll: some View {
        ScrollViewReader { proxy in
            scrollBody
                .onAppear { revealMondayDinner(proxy) }
                .onChange(of: plan?.planName) { _, _ in revealMondayDinner(proxy) }
        }
    }

    private func revealMondayDinner(_ proxy: ScrollViewProxy) {
        guard plan != nil, !keepsPlanSummaryVisible else { return }
        DispatchQueue.main.async {
            proxy.scrollTo("plan-monday-bottom", anchor: .bottom)
        }
    }

    /// App Store screenshots and audit launches use these flags.
    /// Release ignores them: ScreenshotLaunch.isActive is false there and the
    /// audit reads below are compiled into Debug only.
    private var keepsPlanSummaryVisible: Bool {
        if ScreenshotLaunch.isActive { return true }
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains(AuditLaunch.flowQA) { return true }
        return args.contains { $0.hasPrefix("-Audit") }
        #else
        return false
        #endif
    }

    private var foldGuard: PlanFoldGuard {
        PlanFoldGuard(enabled: keepsPlanSummaryVisible, viewportHeight: planViewportHeight)
    }

    /// Opaque bar under the week. It is a sibling of the scroll view, not an
    /// overlay, so the list's last visible pixel is the bar's top edge.
    private var generateBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Theme.fmSeparator)
                .frame(height: 0.5)
            generateButton
                .padding(.horizontal, Theme.Spacing.four)
                .padding(.vertical, Theme.Spacing.four)
        }
        .background(Theme.fmBackground)
    }

    /// Targets stay outside the scrolling week so the fields cannot slide
    /// under the Meals / Training switch.
    private var targetsHeader: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.three) {
            Picker("Goal", selection: $goal) {
                ForEach(goals, id: \.id) { item in
                    Text(item.label)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .tag(item.id)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("plan-goal")

            HStack {
                labeledField("Calories", text: $calories)
                labeledField("Protein g", text: $protein)
            }

            Text("Prices vary by store and week.")
                .font(.footnote)
                .foregroundStyle(Theme.fmSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Theme.Spacing.four)
        .padding(.vertical, Theme.Spacing.two)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
        .padding(.horizontal, Theme.Spacing.four)
        .padding(.top, Theme.Spacing.two)
        .padding(.bottom, Theme.Spacing.one)
    }

    private var scrollBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.three) {
                OfflineNotice()

                Text("Build a week from your calorie and protein targets.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.footnote)
                }

                if let plan {
                    planSummary(plan)
                } else if isLoading {
                    LoadingSkeleton(rows: 3, label: "Loading your week", identifier: "plan-loading")
                } else {
                    planEmptyState
                }
            }
            .padding(.horizontal, Theme.Spacing.four)
            .padding(.top, Theme.Spacing.two)
            .padding(.bottom, 24)
        }
        .defaultScrollAnchor(.top)
        .scrollClipDisabled(false)
        .contentMargins(.bottom, 16, for: .scrollContent)
        .coordinateSpace(name: planScrollSpace)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .preference(key: PlanViewportHeightKey.self, value: proxy.size.height)
            }
            .accessibilityHidden(true)
        }
        .onPreferenceChange(PlanViewportHeightKey.self) { height in
            if abs(height - planViewportHeight) > 0.5 {
                planViewportHeight = height
            }
        }
    }

    private func planSummary(_ plan: MealPlanPayload) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.three) {
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            Text(plan.planName ?? "Your plan")
                .font(.title3.bold())
                .accessibilityIdentifier("plan-preview")
            if let summary = plan.summary {
                Text(summary)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("plan-summary")
            }
        }

        ForEach(plan.days ?? [], id: \.day) { day in
            VStack(alignment: .leading, spacing: Theme.Spacing.two) {
                Text(day.day ?? "Day")
                    .font(.headline)
                    .modifier(foldGuard)
                mealRow("Breakfast", day.meals?.breakfast)
                mealRow("Lunch", day.meals?.lunch)
                mealRow("Dinner", day.meals?.dinner, identifier: day.day == "Monday" ? "plan-monday-dinner" : nil)
                mealRow("Snack", day.meals?.snack)
                if let totals = day.dailyTotals {
                    Text("Day total · \(totals.calories ?? 0) kcal · \(totals.protein ?? 0)g protein")
                        .font(.footnote)
                        .foregroundStyle(Theme.fmSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .modifier(foldGuard)
                }
            }
            .padding(Theme.Spacing.four)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
            .id(day.day == "Monday" ? "plan-monday-bottom" : nil)
        }
        }
    }

    /// Symbol, explanation, and action. A lone button is not an empty state.
    private var planEmptyState: some View {
        VStack(spacing: Theme.Spacing.three) {
            Image(systemName: "calendar")
                .font(.system(size: 32))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.fmBrand)
            Text("No plan yet")
                .font(.headline.weight(.semibold))
            Text("Set your targets and FitMunch builds 7 days of meals.")
                .font(.subheadline)
                .foregroundStyle(Theme.fmSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.six)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("plan-empty")
    }

    private var generateButton: some View {
        Button {
            Task { await generate() }
        } label: {
            Text(isLoading ? "Building your week…" : (plan == nil ? "Build my week" : "Generate 7-day plan"))
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
        }
        .background(Theme.fmBrand.opacity(isLoading ? 0.85 : 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .disabled(isLoading)
        .accessibilityLabel("Generate 7-day plan")
        .accessibilityIdentifier("plan-generate")
    }

    private func labeledField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.one) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: text)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
        }
    }

    /// The id is on the meal-name text, a leaf static text. Container ids were
    /// not in the XCTest tree.
    @ViewBuilder
    private func mealRow(_ label: String, _ meal: MealPlanMeal?, identifier: String? = nil) -> some View {
        if let meal {
            if let identifier {
                mealRowLabel(label, meal, identifier: identifier)
                    .id(identifier)
                    .modifier(foldGuard)
            } else {
                mealRowLabel(label, meal, identifier: nil)
                    .accessibilityElement(children: .contain)
                    .modifier(foldGuard)
            }
        }
    }

    private func mealRowLabel(_ label: String, _ meal: MealPlanMeal, identifier: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            mealName(label, meal, identifier: identifier)
            Text("\(meal.calories ?? 0) kcal · \(meal.protein ?? 0)g protein per serve · \(meal.prepMins ?? 0) min")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func mealName(_ label: String, _ meal: MealPlanMeal, identifier: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(Theme.fmSecondary)
            Text(meal.name ?? "Meal")
                .font(.headline.weight(.semibold))
                .modifier(MealNameID(identifier: identifier))
        }
    }

    private struct MealNameID: ViewModifier {
        let identifier: String?
        func body(content: Content) -> some View {
            if let identifier {
                content.accessibilityIdentifier(identifier)
            } else {
                content
            }
        }
    }

    private func generate() async {
        errorMessage = nil
        if consent.needsPrompt(auth.user?.id) {
            showConsent = true
            return
        }
        if consent.isDenied(auth.user?.id) {
            errorMessage = AIConsentCopy.planBlocked
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await APIClient.request(
                "/meal-plan/generate",
                method: "POST",
                body: [
                    "goal": goal,
                    "calories": Int(calories) ?? 2000,
                    "protein": Int(protein) ?? 150,
                    "days": 7,
                ],
                as: MealPlanGenerateResponse.self
            )
            if response.upgrade == true {
                freeLimitHits += 1
                showPaywall = true
                errorMessage = response.error ?? "Upgrade for more AI meal plans."
                return
            }
            guard response.success == true, let plan = response.plan else {
                throw APIError.server(response.error ?? "Could not generate plan.")
            }
            self.plan = plan
            plansGenerated += 1
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PlanViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct PlanRowFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        value = nextValue()
    }
}

/// Store and audit launches rest at the top of the week. A row that crosses
/// the bottom of the scroll view is hidden whole, so the resting shot never
/// shows a cut meal title or a title without its kcal line. Normal launches
/// pass enabled = false and are not measured.
private struct PlanFoldGuard: ViewModifier {
    let enabled: Bool
    let viewportHeight: CGFloat
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .opacity(crossesFold ? 0 : 1)
            .accessibilityHidden(crossesFold)
            .background {
                if enabled {
                    GeometryReader { proxy in
                        Color.clear
                            .preference(key: PlanRowFrameKey.self, value: proxy.frame(in: .named(planScrollSpace)))
                    }
                    .accessibilityHidden(true)
                }
            }
            .onPreferenceChange(PlanRowFrameKey.self) { next in
                if next != frame {
                    frame = next
                }
            }
    }

    private var crossesFold: Bool {
        guard enabled, viewportHeight > 0, frame.height > 0 else { return false }
        return frame.minY < viewportHeight && frame.maxY > viewportHeight
    }
}

#Preview {
    MealPlanView()
        .environmentObject(AuthManager.shared)
}
