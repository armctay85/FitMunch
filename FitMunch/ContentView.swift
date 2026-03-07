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
            
            // Placeholder for log meal - will be replaced with actual view
            Text("Log Meal")
                .tabItem {
                    Label("Log", systemImage: "plus.circle.fill")
                }
                .tag(1)
                .onAppear {
                    // When this tab is selected, show the log meal sheet
                    // and then return to home tab
                    DispatchQueue.main.async {
                        selectedTab = 0
                        // In a real app, you would trigger sheet presentation here
                    }
                }
            
            HistoryView(modelContext: modelContext)
                .tabItem {
                    Label("History", systemImage: "chart.line.uptrend.xyaxis")
                }
                .tag(2)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(3)
        }
        .tint(.blue)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}