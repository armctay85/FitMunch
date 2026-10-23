import SwiftUI
import SwiftData

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
                    // A tab switch posted from the Coach button is dropped in the
                    // same turn. Apply it on the next run loop so Me actually opens.
                    DispatchQueue.main.async {
                        selectedTab = .me
                        privacyRequest += 1
                    }
                }
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
            }
            Tab("Plan", systemImage: "calendar", value: AppTab.plan) {
                PlanView()
                    .accessibilityIdentifier("tab-plan")
            }
            Tab("Scan", systemImage: "viewfinder", value: AppTab.scan) {
                ReceiptScanView()
                    .accessibilityIdentifier("tab-scan")
            }
            Tab("Coach", systemImage: "sparkles", value: AppTab.coach) {
                CoachView()
                    .accessibilityIdentifier("tab-coach")
            }
            Tab("Me", systemImage: "person.crop.circle.fill", value: AppTab.me) {
                SettingsView(privacyRequest: privacyRequest)
                    .accessibilityIdentifier("tab-me")
            }
        }
    }

    /// iOS 17 deployment fallback. Same five tabs, classic TabView items.
    private var legacyTabs: some View {
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
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}
