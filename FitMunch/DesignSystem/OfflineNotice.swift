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
                .font(.subheadline)
                .foregroundStyle(Color(red: 63.0 / 255, green: 90.0 / 255, blue: 73.0 / 255))
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .padding(.horizontal, Theme.Spacing.three)
                .background(Color(red: 227.0 / 255, green: 242.0 / 255, blue: 231.0 / 255))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("You're offline. Your logged meals are safe.")
        }
    }
}
