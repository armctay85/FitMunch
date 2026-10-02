import SwiftUI

/// Plan tab: meals and training in one segmented control so the bar stays at five tabs.
struct PlanView: View {
    enum Segment: String, CaseIterable, Identifiable {
        case meals = "Meals"
        case training = "Training"

        var id: String { rawValue }
    }

    @State private var segment: Segment = .meals

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Plan", selection: $segment) {
                    ForEach(Segment.allCases) { item in
                        Text(item.rawValue)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(.horizontal, Theme.Spacing.four)
                .padding(.vertical, Theme.Spacing.three)
                .accessibilityIdentifier("plan-segment")
                .sensoryFeedback(.selection, trigger: segment)

                switch segment {
                case .meals:
                    MealPlanView(embedded: true)
                case .training:
                    WorkoutView(embedded: true)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.surface)
            .navigationTitle("Plan")
        }
    }
}

#Preview {
    PlanView()
}
