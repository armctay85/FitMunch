import SwiftUI

/// AI meal planner — same `/api/meal-plan/generate` rail as the web app.
struct MealPlanView: View {
    @State private var calories = "2000"
    @State private var protein = "150"
    @State private var budget = "120"
    @State private var goal = "general_fitness"
    @State private var plan: MealPlanPayload?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showPaywall = false

    private let goals: [(id: String, label: String)] = [
        ("general_fitness", "General fitness"),
        ("lose_weight", "Fat loss"),
        ("muscle_gain", "Muscle gain"),
        ("maintain", "Maintain"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Build a Woolies/Coles week from your targets.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    VStack(spacing: 12) {
                        Picker("Goal", selection: $goal) {
                            ForEach(goals, id: \.id) { g in
                                Text(g.label).tag(g.id)
                            }
                        }
                        .pickerStyle(.segmented)

                        HStack {
                            labeledField("Calories", text: $calories)
                            labeledField("Protein g", text: $protein)
                            labeledField("Budget $", text: $budget)
                        }

                        Button {
                            Task { await generate() }
                        } label: {
                            if isLoading {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Generate 7-day plan")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.086, green: 0.639, blue: 0.290))
                        .disabled(isLoading)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }

                    if let plan {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(plan.planName ?? "Your plan")
                                .font(.title3.bold())
                            if let summary = plan.summary {
                                Text(summary)
                                    .foregroundStyle(.secondary)
                            }
                            HStack(spacing: 16) {
                                if let c = plan.avgDailyCalories { metric("Avg kcal", "\(c)") }
                                if let p = plan.avgDailyProtein { metric("Avg protein", "\(p)g") }
                                if let b = plan.weeklyBudgetEst { metric("Est. shop", "$\(b)") }
                            }
                        }

                        ForEach(plan.days ?? [], id: \.day) { day in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(day.day ?? "Day")
                                    .font(.headline)
                                mealRow("Breakfast", day.meals?.breakfast)
                                mealRow("Lunch", day.meals?.lunch)
                                mealRow("Dinner", day.meals?.dinner)
                                mealRow("Snack", day.meals?.snack)
                                if let t = day.dailyTotals {
                                    Text("Day total · \(t.calories ?? 0) kcal · \(t.protein ?? 0)g protein")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Meal Plan")
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
        }
    }

    private func labeledField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: text)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func mealRow(_ label: String, _ meal: MealPlanMeal?) -> some View {
        if let meal {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(label): \(meal.name ?? "Meal")")
                    .font(.subheadline.weight(.semibold))
                Text("\(meal.calories ?? 0) kcal · \(meal.protein ?? 0)g protein · \(meal.prepMins ?? 0) min")
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
                    "budget": Int(budget) ?? 120,
                    "days": 7,
                ],
                as: MealPlanGenerateResponse.self
            )
            if response.upgrade == true {
                showPaywall = true
                errorMessage = response.error ?? "Upgrade for more AI meal plans."
                return
            }
            guard response.success == true, let plan = response.plan else {
                throw APIError.server(response.error ?? "Could not generate plan.")
            }
            self.plan = plan
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    MealPlanView()
}
