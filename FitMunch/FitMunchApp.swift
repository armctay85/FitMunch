import SwiftUI
import SwiftData
import RevenueCat

/// Main app entry point
@main
struct FitMunchApp: App {
    @StateObject private var premiumManager: PremiumManager
    @StateObject private var auth: AuthManager

    init() {
        #if DEBUG
        LaunchFrameCapture.holdIfRequested()
        #endif
        _premiumManager = StateObject(wrappedValue: PremiumManager.shared)
        _auth = StateObject(wrappedValue: AuthManager.shared)
    }
    
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            UserProfile.self,
            Meal.self,
            FoodItem.self,
            WorkoutLog.self,
        ])
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: ScreenshotLaunch.isActive
        )
        
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
            .tint(Theme.brandGreen)
        }
    }
}