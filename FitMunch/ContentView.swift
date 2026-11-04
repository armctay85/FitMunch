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

        override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
            super.traitCollectionDidChange(previousTraitCollection)
            apply()
        }

        func apply() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let window = self.window, let bar = Self.find(in: window) else { return }
                let dark = window.traitCollection.userInterfaceStyle == .dark
                let backingColor = (dark
                    ? UIColor(red: 16.0 / 255, green: 26.0 / 255, blue: 20.0 / 255, alpha: 1)
                    : UIColor(red: 244.0 / 255, green: 246.0 / 255, blue: 242.0 / 255, alpha: 1)
                ).withAlphaComponent(0.94)
                let hairline = dark
                    ? UIColor(red: 38.0 / 255, green: 48.0 / 255, blue: 42.0 / 255, alpha: 1)
                    : UIColor(red: 217.0 / 255, green: 222.0 / 255, blue: 217.0 / 255, alpha: 1)
                let appearance = UITabBarAppearance()
                appearance.configureWithDefaultBackground()
                appearance.backgroundEffect = UIBlurEffect(style: .systemMaterial)
                appearance.backgroundColor = backingColor
                appearance.shadowColor = hairline
                appearance.shadowImage = Self.hairlineImage(hairline)
                bar.standardAppearance = appearance
                bar.scrollEdgeAppearance = appearance
                bar.isTranslucent = true
                Self.installBacking(behind: bar, in: window, color: backingColor, hairline: hairline)
            }
        }

        /// Page color under the floating glass. A sibling, not a layout change,
        /// so the tab button top and the meal cards stay where they are.
        private static let backingTag = 918_273

        private static func installBacking(behind bar: UITabBar, in window: UIWindow, color: UIColor, hairline: UIColor) {
            let glass = glassView(around: bar, in: window)
            guard let parent = glass.superview else { return }
            let backing: UIView
            if let existing = parent.viewWithTag(backingTag) {
                backing = existing
            } else {
                let view = UIView()
                view.tag = backingTag
                view.isUserInteractionEnabled = false
                view.isAccessibilityElement = false
                parent.insertSubview(view, belowSubview: glass)
                backing = view
            }
            var frame = glass.frame
            if let buttonTop = tabButtonTop(in: window) {
                let limit = buttonTop - 10
                let glassTop = glass.convert(glass.bounds, to: window).minY
                if glassTop < limit {
                    let cut = limit - glassTop
                    frame.origin.y += cut
                    frame.size.height -= cut
                }
            }
            backing.frame = frame
            backing.backgroundColor = color
            backing.layer.cornerRadius = max(glass.layer.cornerRadius, 28)
            backing.layer.cornerCurve = .continuous
            backing.clipsToBounds = true
            let lineTag = backingTag + 1
            let line: UIView
            if let existing = backing.viewWithTag(lineTag) {
                line = existing
            } else {
                let view = UIView()
                view.tag = lineTag
                view.isUserInteractionEnabled = false
                backing.addSubview(view)
                line = view
            }
            line.backgroundColor = hairline
            line.frame = CGRect(x: 0, y: 0, width: backing.bounds.width, height: 0.5)
        }

        /// Highest tab button. The backing stays at this line so meal cards above it are untouched.
        private static func tabButtonTop(in window: UIWindow) -> CGFloat? {
            let names: Set<String> = ["Today", "Plan", "Scan", "Coach", "Me"]
            var tops: [CGFloat] = []
            func walk(_ view: UIView) {
                if let label = view.accessibilityLabel, names.contains(label) {
                    let frame = view.convert(view.bounds, to: window)
                    if frame.height > 16, frame.minY > window.bounds.maxY - 150 {
                        tops.append(frame.minY)
                    }
                }
                for child in view.subviews { walk(child) }
            }
            walk(window)
            return tops.min()
        }

        /// The visual pill. UITabBar.bounds sits under that glass.
        private static func glassView(around bar: UITabBar, in window: UIWindow) -> UIView {
            var best = bar
            var bestTop = bar.convert(bar.bounds, to: window).minY
            func consider(_ view: UIView) {
                let frame = view.convert(view.bounds, to: window)
                guard frame.width > window.bounds.width * 0.7 else { return }
                guard frame.height > 48, frame.height < 140 else { return }
                guard frame.maxY > window.bounds.maxY - 12 else { return }
                guard frame.minY > window.bounds.maxY - 170 else { return }
                if frame.minY < bestTop {
                    bestTop = frame.minY
                    best = view
                }
            }
            var node: UIView? = bar
            var levels = 0
            while let current = node, levels < 4 {
                consider(current)
                for child in current.subviews {
                    consider(child)
                }
                node = current.superview
                levels += 1
            }
            return best
        }

        private static func hairlineImage(_ color: UIColor) -> UIImage {
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 0.5))
            return renderer.image { _ in
                color.setFill()
                UIRectFill(CGRect(x: 0, y: 0, width: 1, height: 0.5))
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
