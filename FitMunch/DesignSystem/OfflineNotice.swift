import SwiftUI

/// Offline empty state. Logged meals stay on device.
struct OfflineNotice: View {
    var prominent: Bool = false

    @ObservedObject private var network = NetworkMonitor.shared

    var body: some View {
        if network.isOnline {
            EmptyView()
        } else if prominent {
            ContentUnavailableView {
                Label("You're offline", systemImage: "wifi.slash")
            } description: {
                Text("You're offline. Your logged meals are safe.")
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("You're offline. Your logged meals are safe.")
        } else {
            Label("You're offline. Your logged meals are safe.", systemImage: "wifi.slash")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Spacing.three)
                .background(Theme.brandGreenSoft)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("You're offline. Your logged meals are safe.")
        }
    }
}
