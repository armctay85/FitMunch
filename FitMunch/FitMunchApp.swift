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
        MealLogTiming.shared.mark("initBegan")
        MealLogTiming.shared.disarmWaits()
        #if DEBUG
        LaunchFrameCapture.holdIfRequested()
        #endif
        AppearanceLaunch.prepare()
        _premiumManager = StateObject(wrappedValue: PremiumManager.shared)
        MealLogTiming.shared.mark("premiumReady")
        _auth = StateObject(wrappedValue: AuthManager.shared)
        MealLogTiming.shared.mark("authReady")
    }
    
    var sharedModelContainer: ModelContainer = {
        MealLogTiming.shared.mark("containerBegan")
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
            let container = try ModelContainer(for: schema, configurations: [modelConfiguration])
            MealLogTiming.shared.mark("containerEnded")
            return container
        } catch {
            MealLogTiming.shared.mark("containerFailed")
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
            .transaction { transaction in
                if MealLogTiming.isEnabled {
                    transaction.disablesAnimations = true
                }
            }
            .background {
                MealLogTimingHost()
            }
            .onAppear {
                AppearanceLaunch.applyWindows()
                ScreenFill.apply()
                var width: CGFloat = 0
                for scene in UIApplication.shared.connectedScenes {
                    guard let windowScene = scene as? UIWindowScene else { continue }
                    for window in windowScene.windows where window.bounds.width > width {
                        width = window.bounds.width
                    }
                }
                MealLogTiming.shared.markFirstFrame(width: Int(width.rounded()))
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