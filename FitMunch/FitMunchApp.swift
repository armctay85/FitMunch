import SwiftUI
import SwiftData
import UIKit
import RevenueCat

/// Main app entry point
@main
struct FitMunchApp: App {
    @StateObject private var premiumManager: PremiumManager
    @StateObject private var auth: AuthManager
    #if DEBUG
    @State private var showingLaunchHold = LaunchFrameCapture.isRequested
    #endif

    init() {
        #if DEBUG
        LaunchFrameCapture.holdIfRequested()
        #endif
        OpaqueBars.apply()
        FloatingBarBacking.applyGlobals()
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
                    LoadingSkeletonScreen(rows: 4, label: "Loading FitMunch", identifier: "launch-loading")
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
            #if DEBUG
            .overlay {
                if LaunchFrameCapture.isRequested && showingLaunchHold {
                    LaunchFrameCover {
                        showingLaunchHold = false
                    }
                }
            }
            #endif
        }
    }
}

/// Opaque navigation bars. iOS 26's scroll-edge glass leaves the date and
/// section titles readable behind the Today title.
enum OpaqueBars {
    static func apply() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(named: "Surface") ?? .systemBackground
        appearance.shadowColor = .clear
        appearance.titleTextAttributes = [.foregroundColor: UIColor.label]
        appearance.largeTitleTextAttributes = [.foregroundColor: UIColor.label]
        let nav = UINavigationBar.appearance()
        nav.standardAppearance = appearance
        nav.scrollEdgeAppearance = appearance
        nav.compactAppearance = appearance
        nav.compactScrollEdgeAppearance = appearance
        nav.isTranslucent = false
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