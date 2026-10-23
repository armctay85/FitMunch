import SwiftUI
import SwiftData
import UIKit

/// Five tabs. iOS hides a sixth item behind More, so History lives on Me.
extension Notification.Name {
    static let fitMunchOpenPrivacy = Notification.Name("FitMunchOpenPrivacy")
}

enum AppTab: Hashable {
    case today
    case plan
    case scan
    case coach
    case me
}

/// Main content view with tab navigation.
struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @AppStorage(Constants.UserDefaultsKeys.hasCompletedOnboarding) private var hasCompletedOnboarding = false
    @State private var selectedTab: AppTab = .today
    @State private var privacyRequest = 0

    var body: some View {
        if hasCompletedOnboarding {
            mainTabs
                .tint(Theme.brandGreen)
                .onReceive(NotificationCenter.default.publisher(for: .fitMunchOpenPrivacy)) { _ in
                    openPrivacy()
                }
                .onAppear {
                    ScreenshotLaunch.seedMealsIfNeeded(into: modelContext)
                }
        } else {
            OnboardingView()
        }
    }

    /// iOS 18's `Tab(_:value:)` ignores a selection change that starts inside
    /// the current tab, so Allow in Privacy never landed on Me. `tabItem` +
    /// `tag` honors `selectedTab` on 17 and 18. The system tab bar still draws.
    @ViewBuilder
    private var mainTabs: some View {
        TabView(selection: $selectedTab) {
            HomeView(modelContext: modelContext)
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
                .accessibilityIdentifier("tab-today")
                .tag(AppTab.today)

            PlanView()
                .tabItem { Label("Plan", systemImage: "calendar") }
                .accessibilityIdentifier("tab-plan")
                .tag(AppTab.plan)

            ReceiptScanView()
                .tabItem { Label("Scan", systemImage: "viewfinder") }
                .accessibilityIdentifier("tab-scan")
                .tag(AppTab.scan)

            CoachView()
                .tabItem { Label("Coach", systemImage: "sparkles") }
                .accessibilityIdentifier("tab-coach")
                .tag(AppTab.coach)

            SettingsView(privacyRequest: privacyRequest)
                .tabItem { Label("Me", systemImage: "person.crop.circle.fill") }
                .accessibilityIdentifier("tab-me")
                .tag(AppTab.me)
        }
    }

    private func openPrivacy() {
        selectedTab = .me
        privacyRequest += 1
        TabBarSelector.select(title: "Me")
        DispatchQueue.main.async {
            selectedTab = .me
            TabBarSelector.select(title: "Me")
        }
    }
}

/// SwiftUI sometimes paints the old tab after the binding changes. The
/// UITabBarController index is what the screen actually shows.
enum TabBarSelector {
    static func select(title: String) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            for window in scene.windows {
                select(title: title, in: window.rootViewController)
            }
        }
    }

    private static func select(title: String, in controller: UIViewController?) {
        guard let controller else { return }
        if let tabs = controller as? UITabBarController {
            let items = tabs.tabBar.items ?? []
            if let index = items.firstIndex(where: { $0.title == title || $0.accessibilityLabel == title }) {
                tabs.selectedIndex = index
                return
            }
            if let controllers = tabs.viewControllers,
               let index = controllers.firstIndex(where: {
                   $0.tabBarItem.title == title || $0.tabBarItem.accessibilityLabel == title
               }) {
                tabs.selectedIndex = index
                return
            }
        }
        for child in controller.children {
            select(title: title, in: child)
        }
        select(title: title, in: controller.presentedViewController)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}
