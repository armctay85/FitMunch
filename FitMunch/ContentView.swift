import SwiftUI
import SwiftData

/// Main content view with tab navigation
struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @AppStorage(Constants.UserDefaultsKeys.hasCompletedOnboarding) private var hasCompletedOnboarding = false
    @State private var selectedTab = 0
    
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
                .tag(0)
            
            CoachView()
                .tabItem {
                    Label("Coach", systemImage: "bubble.left.and.text.bubble.right.fill")
                }
                .tag(1)
            
            ReceiptScanView()
                .tabItem {
                    Label("Scan", systemImage: "camera.viewfinder")
                }
                .tag(2)
            
            HistoryView(modelContext: modelContext)
                .tabItem {
                    Label("History", systemImage: "chart.line.uptrend.xyaxis")
                }
                .tag(3)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(4)
        }
        .tint(Color(red: 0.086, green: 0.639, blue: 0.290))
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}