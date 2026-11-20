import SwiftUI
import UIKit

/// Brand colours, spacing, and button styles shared across FitMunch.
/// One dark Forest system. Mint is the accent and is never placed on white or off-white.
enum Theme {
    private static func token(_ red: Double, _ green: Double, _ blue: Double) -> Color {
        Color(red: red / 255.0, green: green / 255.0, blue: blue / 255.0)
    }

    private static func tokenUI(_ red: Double, _ green: Double, _ blue: Double) -> UIColor {
        UIColor(red: red / 255.0, green: green / 255.0, blue: blue / 255.0, alpha: 1)
    }

    /// fm-forest. Page background.
    static let forest = token(15, 42, 31)
    static let forestUIColor = tokenUI(15, 42, 31)
    /// fm-forest-deep. Footer and tab bar.
    static let forestDeep = token(10, 31, 22)
    /// fm-surface. Cards and sheets.
    static let surfaceCard = token(23, 58, 44)
    /// fm-line. Decorative borders and dividers.
    static let line = token(42, 82, 64)
    /// fm-mint. Primary button fill, focus, active tab, key numbers.
    static let mint = token(110, 242, 176)
    /// fm-offwhite. Primary text on Forest.
    static let offwhite = token(243, 240, 232)
    static let offwhiteUIColor = tokenUI(243, 240, 232)
    /// fm-mute-dark. Secondary text on Forest and surface.
    static let muteDark = token(168, 191, 179)
    /// fm-mute-light. Secondary text on a light page.
    static let muteLight = token(79, 99, 88)
    /// fm-error-dark. Errors on Forest.
    static let errorDark = token(255, 143, 128)

    /// Existing names, all mapped onto the token set above. There is no light palette.
    static let brandGreen = mint
    static let brandGreenSoft = forestDeep
    static let surface = forest
    static let green = mint
    static let buttonGreen = mint
    static let secondaryText = muteDark
    static let buttonFill = mint
    static let fmBackground = forest
    static let fmSurface = surfaceCard
    static let fmBrand = mint
    static let fmSecondary = muteDark
    static let fmSeparator = line
    static let fmError = errorDark

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

/// Mint fill, Forest text, 48pt minimum. Pressed fill is Mint at 88%.
/// The label stays Forest on Mint when the button is disabled, so contrast holds.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.forest)
            .tint(Theme.forest)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, Theme.Spacing.four)
            .background(
                Theme.mint.opacity(configuration.isPressed ? 0.88 : 1),
                in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
            )
    }
}

/// Transparent, 1.5pt mute-dark border, off-white text. Same 48pt height as the primary button.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.offwhite)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, Theme.Spacing.four)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                    .stroke(Theme.muteDark, lineWidth: 1.5)
            )
            .opacity(configuration.isPressed ? 0.88 : 1)
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
