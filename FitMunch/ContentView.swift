import SwiftUI
import SwiftData

/// Main content view with tab navigation
struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @AppStorage(Constants.UserDefaultsKeys.hasCompletedOnboarding) private var hasCompletedOnboarding = false
    @State private var selectedTab = 0
    @State private var screenshotReady = false
    
    var body: some View {
        if hasCompletedOnboarding {
            mainContentView
        } else {
            OnboardingView()
        }
    }
    
    /// Main content view with tabs
    private var mainContentView: some View {
        TabView(selection: $selectedTab) {
            HomeView(modelContext: modelContext)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .accessibilityIdentifier("tab-home")
                .tag(0)
            
            CoachView()
                .tabItem {
                    Label("Coach", systemImage: "bubble.left.and.text.bubble.right.fill")
                }
                .accessibilityIdentifier("tab-coach")
                .tag(1)
            
            ReceiptScanView()
                .tabItem {
                    Label("Scan", systemImage: "camera.viewfinder")
                }
                .accessibilityIdentifier("tab-scan")
                .tag(2)

            MealPlanView()
                .tabItem {
                    Label("Meals", systemImage: "fork.knife")
                }
                .accessibilityIdentifier("tab-plan")
                .tag(3)

            WorkoutView()
                .tabItem {
                    Label("Workout", systemImage: "figure.strengthtraining.traditional")
                }
                .tag(4)
            
            HistoryView(modelContext: modelContext)
                .tabItem {
                    Label("History", systemImage: "chart.line.uptrend.xyaxis")
                }
                .tag(5)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .accessibilityIdentifier("tab-settings")
                .tag(6)
        }
        .tint(Color(red: 0.086, green: 0.639, blue: 0.290))
        .preferredColorScheme(ScreenshotLaunch.isActive ? .light : nil)
        .background {
            if ScreenshotLaunch.isActive && screenshotReady {
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityIdentifier("screenshot-ready")
            }
        }
        .onAppear {
            ScreenshotLaunch.seedMealsIfNeeded(into: modelContext)
            ScreenshotLaunch.pinWindowsToScreen()
        }
        .task {
            guard ScreenshotLaunch.isActive else { return }
            for _ in 0..<6 {
                ScreenshotLaunch.pinWindowsToScreen()
                try? await Task.sleep(nanoseconds: 150_000_000)
            }
            screenshotReady = true
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}