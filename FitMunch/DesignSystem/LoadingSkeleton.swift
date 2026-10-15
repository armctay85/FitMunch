import SwiftUI

/// Shared placeholder for Today, Plan, and the paywall while data is in flight.
struct LoadingSkeleton: View {
    var rows: Int = 3
    var label: String = "Loading"

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.three) {
            ForEach(0..<rows, id: \.self) { index in
                RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                    .fill(Color(.secondarySystemBackground))
                    .frame(height: index == 0 ? 96 : 64)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityIdentifier("loading-skeleton")
    }
}
