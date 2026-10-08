import SwiftUI

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
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.five) {
                OfflineNotice()

                Text("Build a week from your calorie and protein targets.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(spacing: Theme.Spacing.three) {
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
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.footnote)
                }

                if let plan {
                    planSummary(plan)
                        .accessibilityIdentifier("plan-preview")
                } else if !isLoading {
                    planEmptyState
                }
            }
            .padding()
        }
        .defaultScrollAnchor(.top)
        .scrollClearsTabBar()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            generateButton
                .padding(.horizontal, Theme.Spacing.four)
                .padding(.top, Theme.Spacing.two)
                .padding(.bottom, Theme.Spacing.three)
                .background(Theme.surface)
        }
        .background(Theme.surface)
        .sensoryFeedback(.selection, trigger: goal)
        .sensoryFeedback(.success, trigger: plansGenerated)
        .sensoryFeedback(.warning, trigger: freeLimitHits)
        .fullScreenCover(isPresented: $showPaywall) {
            PaywallView()
        }
        .onAppear {
            if ScreenshotLaunch.isActive && plan == nil {
                plan = ScreenshotLaunch.mealPlan()
            }
        }
    }

    private func planSummary(_ plan: MealPlanPayload) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.five) {
        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
            Text(plan.planName ?? "Your plan")
                .font(.title3.bold())
            if let summary = plan.summary {
                Text(summary)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: Theme.Spacing.four) {
                if let calories = plan.avgDailyCalories {
                    metric("Avg kcal", "\(calories)")
                }
                if let protein = plan.avgDailyProtein {
                    metric("Avg protein", "\(protein)g")
                }
            }
        }

        ForEach(plan.days ?? [], id: \.day) { day in
            VStack(alignment: .leading, spacing: Theme.Spacing.two) {
                Text(day.day ?? "Day")
                    .font(.headline)
                mealRow("Breakfast", day.meals?.breakfast)
                mealRow("Lunch", day.meals?.lunch)
                mealRow("Dinner", day.meals?.dinner)
                mealRow("Snack", day.meals?.snack)
                if let totals = day.dailyTotals {
                    Text("Day total · \(totals.calories ?? 0) kcal · \(totals.protein ?? 0)g protein")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
        }
        }
    }

    /// Symbol, explanation, and action. A lone button is not an empty state.
    private var planEmptyState: some View {
        VStack(spacing: Theme.Spacing.three) {
            Image(systemName: "calendar")
                .font(.system(size: 44))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.brandGreen)
            Text("No week yet")
                .font(.title3.bold())
            Text("Set your calorie and protein targets, then build a week of meals. Breakfast, lunch, dinner, and a snack show up here.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Build my week") {
                Task { await generate() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("plan-build-week")
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
            if isLoading {
                ProgressView()
                    .tint(.white)
            } else {
                Text("Generate 7-day plan")
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isLoading)
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

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.monospacedDigit())
                .fontDesign(.rounded)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value)")
    }

    @ViewBuilder
    private func mealRow(_ label: String, _ meal: MealPlanMeal?) -> some View {
        if let meal {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(label): \(meal.name ?? "Meal")")
                    .font(.subheadline.weight(.semibold))
                Text("\(meal.calories ?? 0) kcal · \(meal.protein ?? 0)g protein per serve · \(meal.prepMins ?? 0) min")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func generate() async {
        errorMessage = nil
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

#Preview {
    MealPlanView()
}
