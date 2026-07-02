import SwiftUI
import SwiftData
import RevenueCat

/// Main app entry point
@main
struct FitMunchApp: App {
    @StateObject private var premiumManager = PremiumManager.shared
    @StateObject private var auth = AuthManager.shared
    
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            UserProfile.self,
            Meal.self,
            FoodItem.self,
        ])
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        
        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()
    
    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isRestoring {
                    ProgressView()
                        .task { await auth.bootstrap() }
                } else if auth.isAuthenticated {
                    ContentView()
                } else {
                    AuthView()
                }
            }
            .modelContainer(sharedModelContainer)
            .environmentObject(premiumManager)
            .environmentObject(auth)
            .onAppear {
                configureAppearance()
            }
        }
    }
    
    /// Configure global app appearance
    private func configureAppearance() {
        // Configure navigation bar appearance
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = .systemBackground
        
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        
        // Configure tab bar appearance
        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = .systemBackground
        
        UITabBar.appearance().standardAppearance = tabBarAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance
    }
}