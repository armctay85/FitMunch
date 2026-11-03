import SwiftUI
import SwiftData
import UIKit

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
                    openPrivacy()
                }
                .onAppear {
                    ScreenshotLaunch.seedMealsIfNeeded(into: modelContext)
                }
        } else {
            OnboardingView()
        }
    }

    /// iOS 18's `Tab(_:value:)` ignores a selection change that starts inside
    /// the current tab, so Allow in Privacy never landed on Me. `tabItem` +
    /// `tag` honors `selectedTab` on 17 and 18. The system tab bar still draws.
    @ViewBuilder
    private var mainTabs: some View {
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
        .background {
            TabBarChrome()
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .background {
            TabBarOpaqueCover()
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func openPrivacy() {
        selectedTab = .me
        privacyRequest += 1
        TabBarSelector.select(title: "Me")
        DispatchQueue.main.async {
            selectedTab = .me
            TabBarSelector.select(title: "Me")
        }
    }
}

/// SwiftUI sometimes paints the old tab after the binding changes. The
/// UITabBarController index is what the screen actually shows.
enum TabBarSelector {
    static func select(title: String) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            for window in scene.windows {
                select(title: title, in: window.rootViewController)
            }
        }
    }

    private static func select(title: String, in controller: UIViewController?) {
        guard let controller else { return }
        if let tabs = controller as? UITabBarController {
            let items = tabs.tabBar.items ?? []
            if let index = items.firstIndex(where: { $0.title == title || $0.accessibilityLabel == title }) {
                tabs.selectedIndex = index
                return
            }
            if let controllers = tabs.viewControllers,
               let index = controllers.firstIndex(where: {
                   $0.tabBarItem.title == title || $0.tabBarItem.accessibilityLabel == title
               }) {
                tabs.selectedIndex = index
                return
            }
        }
        for child in controller.children {
            select(title: title, in: child)
        }
        select(title: title, in: controller.presentedViewController)
    }
}

/// Solid page color directly behind the tab bar so a card under the glass
/// cannot be read. Sits below the bar, from the button line to the screen bottom.
private struct TabBarOpaqueCover: UIViewRepresentable {
    func makeUIView(context: Context) -> CoverProbe {
        let view = CoverProbe()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: CoverProbe, context: Context) {
        uiView.apply()
    }

    final class CoverProbe: UIView {
        private let plate = UIView()

        override init(frame: CGRect) {
            super.init(frame: frame)
            plate.isUserInteractionEnabled = false
            plate.isAccessibilityElement = false
            plate.backgroundColor = UIColor(red: 244.0 / 255, green: 246.0 / 255, blue: 242.0 / 255, alpha: 1)
        }

        required init?(coder: NSCoder) { nil }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            apply()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            apply()
        }

        func apply() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let window = self.window else { return }
                guard let buttonTop = HomeTabClearanceProbe.tabButtonTop(in: window) else { return }
                guard let bar = Self.findBar(in: window), let parent = bar.superview else { return }
                if self.plate.superview !== parent {
                    parent.insertSubview(self.plate, belowSubview: bar)
                }
                let frame = CGRect(
                    x: 0,
                    y: buttonTop,
                    width: window.bounds.width,
                    height: max(0, window.bounds.maxY - buttonTop)
                )
                self.plate.frame = parent.convert(frame, from: window)
            }
        }

        private static func findBar(in view: UIView) -> UIView? {
            if let bar = view as? UITabBar { return bar }
            for child in view.subviews {
                if let found = findBar(in: child) { return found }
            }
            return nil
        }
    }
}

/// Regular material and a 0.5pt hairline. Item frames stay on the system bar.
private struct TabBarChrome: UIViewRepresentable {
    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: Probe, context: Context) {
        uiView.apply()
    }

    final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            apply()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            apply()
        }

        func apply() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let window = self.window, let bar = Self.find(in: window) else { return }
                let appearance = UITabBarAppearance()
                appearance.configureWithDefaultBackground()
                appearance.backgroundEffect = UIBlurEffect(style: .systemMaterial)
                let dark = window.traitCollection.userInterfaceStyle == .dark
                let hairline = dark
                    ? UIColor(red: 38.0 / 255, green: 48.0 / 255, blue: 42.0 / 255, alpha: 0.6)
                    : UIColor(red: 217.0 / 255, green: 222.0 / 255, blue: 217.0 / 255, alpha: 0.6)
                appearance.shadowColor = hairline
                bar.standardAppearance = appearance
                bar.scrollEdgeAppearance = appearance
            }
        }

        private static func find(in view: UIView) -> UITabBar? {
            if let bar = view as? UITabBar { return bar }
            for child in view.subviews {
                if let found = find(in: child) { return found }
            }
            return nil
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Meal.self, UserProfile.self, FoodItem.self], inMemory: true)
}
