import SwiftUI
import SwiftData

/// Five tabs. iOS hides a sixth item behind More, so History lives on Me.
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

    var body: some View {
        if hasCompletedOnboarding {
            mainTabs
                .tint(Theme.brandGreen)
                .onAppear {
                    ScreenshotLaunch.seedMealsIfNeeded(into: modelContext)
                }
        } else {
            OnboardingView()
        }
    }

    @ViewBuilder
    private var mainTabs: some View {
        if #available(iOS 18.0, *) {
            modernTabs
        } else {
            legacyTabs
        }
    }

    @available(iOS 18.0, *)
    private var modernTabs: some View {
        TabView(selection: $selectedTab) {
            Tab("Today", systemImage: "sun.max.fill", value: AppTab.today) {
                HomeView(modelContext: modelContext)
                    .accessibilityIdentifier("tab-today")
                    .aboveTabBar()
            }
            Tab("Plan", systemImage: "calendar", value: AppTab.plan) {
                PlanView()
                    .accessibilityIdentifier("tab-plan")
                    .aboveTabBar()
            }
            Tab("Scan", systemImage: "viewfinder", value: AppTab.scan) {
                ReceiptScanView()
                    .accessibilityIdentifier("tab-scan")
                    .aboveTabBar()
            }
            Tab("Coach", systemImage: "sparkles", value: AppTab.coach) {
                CoachView()
                    .accessibilityIdentifier("tab-coach")
                    .aboveTabBar()
            }
            Tab("Me", systemImage: "person.crop.circle.fill", value: AppTab.me) {
                SettingsView()
                    .accessibilityIdentifier("tab-me")
                    .aboveTabBar()
            }
        }
    }

    /// iOS 17 deployment fallback. Same five tabs, classic TabView items.
    private var legacyTabs: some View {
        TabView(selection: $selectedTab) {
            HomeView(modelContext: modelContext)
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
                .accessibilityIdentifier("tab-today")
                .aboveTabBar()
                .tag(AppTab.today)

            PlanView()
                .tabItem { Label("Plan", systemImage: "calendar") }
                .accessibilityIdentifier("tab-plan")
                .aboveTabBar()
                .tag(AppTab.plan)

            ReceiptScanView()
                .tabItem { Label("Scan", systemImage: "viewfinder") }
                .accessibilityIdentifier("tab-scan")
                .aboveTabBar()
                .tag(AppTab.scan)

            CoachView()
                .tabItem { Label("Coach", systemImage: "sparkles") }
                .accessibilityIdentifier("tab-coach")
                .aboveTabBar()
                .tag(AppTab.coach)

            SettingsView()
                .tabItem { Label("Me", systemImage: "person.crop.circle.fill") }
                .accessibilityIdentifier("tab-me")
                .aboveTabBar()
                .tag(AppTab.me)
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}
