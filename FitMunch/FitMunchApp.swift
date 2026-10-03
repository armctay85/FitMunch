import SwiftUI
import SwiftData
import UIKit
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
        AppearanceLaunch.prepare()
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
            .preferredColorScheme(AppearanceLaunch.colorScheme)
            .background(Theme.surface)
            .onAppear {
                AppearanceLaunch.applyWindows()
                ScreenFill.apply()
            }
        }
    }
}

/// A missing launch screen used to leave the app in a short window with black bars.
private enum ScreenFill {
    static func apply() {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            let bounds = scene.screen.bounds
            for window in scene.windows {
                window.backgroundColor = UIColor(named: "Surface")
                let size = window.bounds.size
                if abs(size.width - bounds.width) > 1 || abs(size.height - bounds.height) > 1 {
                    window.frame = bounds
                }
            }
        }
    }
}