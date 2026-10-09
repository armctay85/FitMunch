import SwiftUI

/// Guideline 5.1.2(i). One sheet, two buttons, shared by Coach, Scan, and Plan.
struct AIDataConsentSheet: View {
    var onAllow: () -> Void
    var onNotNow: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.four) {
                    Text("Coach, Scan, and Plan use this one choice. It is stored on your account.")
                        .font(.body)
                    Text("Coach sends up to 12 recent messages, including the coach's replies. The server keeps at most 20. Age, weight, height, goal, and diet are added from your account profile. They are not typed into the chat. FitMunch tries xAI, then OpenAI, then Anthropic. This data is processed in the United States.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("A receipt photo goes to xAI or OpenAI only. It is processed in the United States.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("A meal plan sends the goal as a label, calories, protein, and the number of days. It uses that same provider order and is processed in the United States.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Not now leaves Coach, Scan, Plan, insights, workout plans, and the weekly review off. The rest of FitMunch keeps working. You can change this later in Me, Privacy.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(Theme.Spacing.four)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Theme.surface)
            .navigationTitle("AI data")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: Theme.Spacing.two) {
                    Button("Allow", action: onAllow)
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("ai-consent-allow")
                    Button("Not now", action: onNotNow)
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityIdentifier("ai-consent-not-now")
                }
                .padding(.horizontal, Theme.Spacing.four)
                .padding(.vertical, Theme.Spacing.three)
                .background(Theme.surface)
            }
        }
        .accessibilityIdentifier("ai-consent-sheet")
    }
}

enum AIConsentCopy {
    static let coachBlocked = "Coach stays off until you allow it in Me, Privacy."
    static let scanBlocked = "Receipt scan stays off until you allow it in Me, Privacy."
    static let planBlocked = "Meal plans stay off until you allow it in Me, Privacy."
}
