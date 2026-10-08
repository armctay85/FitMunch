import SwiftUI
import UIKit

/// Brand colours, spacing, and button styles shared across FitMunch.
enum Theme {
    static let brandGreen = Color("BrandGreen")
    static let brandGreenSoft = Color("BrandGreenSoft")
    static let surface = Color("Surface")

    /// Icon highlight from main (#2BBF5A). Not a fill behind white text.
    static let green = Color(red: 43.0 / 255.0, green: 191.0 / 255.0, blue: 90.0 / 255.0)

    /// Paywall CTA fill from main (#167A36). White on this green is 5.42:1.
    static let buttonGreen = Color(red: 22.0 / 255.0, green: 122.0 / 255.0, blue: 54.0 / 255.0)

    /// Secondary copy. Light #595959 is 7.0:1 on white and 6.3:1 on the selected plan wash.
    /// Dark #B8B8B8 stays above 4.5:1 on the dark paywall. #595959 on that background is about 2.4:1.
    static let secondaryText: Color = {
        let light = UIColor(red: 89.0 / 255.0, green: 89.0 / 255.0, blue: 89.0 / 255.0, alpha: 1)
        let dark = UIColor(red: 184.0 / 255.0, green: 184.0 / 255.0, blue: 184.0 / 255.0, alpha: 1)
        let dynamic = UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        }
        return Color(uiColor: dynamic)
    }()

    /// Filled buttons stay on the light BrandGreen (#15803D) in both appearances.
    /// White 17pt type on that green is 5.0:1. The dark asset (#22C55E) is for icons and tints.
    static let buttonFill: Color = {
        let light = UITraitCollection(userInterfaceStyle: .light)
        let resolved = UIColor(named: "BrandGreen")?.resolvedColor(with: light) ?? .systemGreen
        return Color(uiColor: resolved)
    }()

    /// 16pt cards, 12pt controls.
    enum Radius {
        static let large: CGFloat = 16
        static let medium: CGFloat = 12
    }

    /// 4-point spacing scale.
    enum Spacing {
        static let one: CGFloat = 4
        static let two: CGFloat = 8
        static let three: CGFloat = 12
        static let four: CGFloat = 16
        static let five: CGFloat = 20
        static let six: CGFloat = 24
        static let eight: CGFloat = 32
        /// Clears the floating tab bar, including the glass above the tab buttons.
        static let tabClearance: CGFloat = 120
    }
}

/// Filled BrandGreen, white 17pt semibold.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.white)
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, 14)
            .padding(.horizontal, Theme.Spacing.four)
            .background(Theme.buttonFill, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
            .opacity(!isEnabled ? 0.55 : (configuration.isPressed ? 0.88 : 1))
    }
}

/// Soft brand fill with BrandGreen 17pt semibold type.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Theme.brandGreen)
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .padding(.horizontal, Theme.Spacing.four)
            .background(Theme.brandGreenSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
            .opacity(!isEnabled ? 0.55 : (configuration.isPressed ? 0.88 : 1))
    }
}

/// Calorie and protein figures. Snaps when Reduce Motion is on, and during screenshot capture.
struct MacroNumber: View {
    let value: Int
    var style: Font.TextStyle = .headline

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = 0

    var body: some View {
        Text("\(shown)")
            .font(.system(style, design: .rounded).monospacedDigit().weight(.bold))
            .contentTransition(.numericText())
            .onAppear { apply(value) }
            .onChange(of: value) { _, newValue in apply(newValue) }
    }

    private func apply(_ newValue: Int) {
        guard shown != newValue else { return }
        if reduceMotion || ScreenshotLaunch.isActive {
            shown = newValue
        } else {
            withAnimation(.spring(duration: 0.8)) {
                shown = newValue
            }
        }
    }
}

extension View {
    /// Same shared inset as `floatingTabBarInset()`. Kept so older call sites
    /// do not bring back a fixed spacer behind the tab bar.
    func aboveTabBar() -> some View {
        floatingTabBarInset()
    }

    /// Bottom margin inside scroll views so the last row can rest above the tab bar.
    func scrollClearsTabBar() -> some View {
        contentMargins(.bottom, Theme.Spacing.tabClearance, for: .scrollContent)
            .safeAreaPadding(.bottom, Theme.Spacing.two)
    }
}
