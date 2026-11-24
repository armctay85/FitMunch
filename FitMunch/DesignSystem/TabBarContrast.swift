import UIKit

/// Colours for the floating tab bar and the WCAG contrast of its icons and labels.
/// One Forest system in both appearances. Selected tabs are Mint. Labels are mute-dark.
/// The wash is Forest Deep at 0.98 over the material, so row text behind the bar is not readable.
enum TabBarContrast {
    static let washOpacity: Double = 0.98

    struct RGB {
        var r: Double
        var g: Double
        var b: Double

        var luminance: Double {
            func channel(_ value: Double) -> Double {
                if value <= 0.04045 { return value / 12.92 }
                return pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }

        fileprivate var uiColor: UIColor {
            UIColor(red: r, green: g, blue: b, alpha: 1)
        }
    }

    /// fm-mint. Active tab icon and label.
    static let lightSelected = RGB(r: 110.0 / 255.0, g: 242.0 / 255.0, b: 176.0 / 255.0)
    static let darkSelected = lightSelected
    /// fm-mute-dark. Unselected tab icon and label.
    static let lightNormal = RGB(r: 168.0 / 255.0, g: 191.0 / 255.0, b: 179.0 / 255.0)
    static let darkNormal = lightNormal
    /// fm-forest. Page behind the bar.
    static let lightPage = RGB(r: 15.0 / 255.0, g: 42.0 / 255.0, b: 31.0 / 255.0)
    static let darkPage = lightPage
    /// fm-line. Decorative hairline.
    static let lightSeparator = RGB(r: 42.0 / 255.0, g: 82.0 / 255.0, b: 64.0 / 255.0)
    static let darkSeparator = lightSeparator
    static let white = RGB(r: 1, g: 1, b: 1)
    /// fm-surface. Cards behind the bar wash.
    static let darkCard = RGB(r: 23.0 / 255.0, g: 58.0 / 255.0, b: 44.0 / 255.0)
    /// fm-forest-deep. Tab bar wash.
    static let bar = RGB(r: 10.0 / 255.0, g: 31.0 / 255.0, b: 22.0 / 255.0)

    /// Page colour at `washOpacity` composited over whatever is scrolling behind the bar.
    static func composite(_ wash: RGB, over back: RGB, opacity: Double = washOpacity) -> RGB {
        RGB(
            r: wash.r * opacity + back.r * (1 - opacity),
            g: wash.g * opacity + back.g * (1 - opacity),
            b: wash.b * opacity + back.b * (1 - opacity)
        )
    }

    static func ratio(_ ink: RGB, on back: RGB) -> Double {
        let lighter = max(ink.luminance, back.luminance)
        let darker = min(ink.luminance, back.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    static var selectedUIColor: UIColor {
        dynamic(light: lightSelected, dark: darkSelected)
    }

    static var normalUIColor: UIColor {
        dynamic(light: lightNormal, dark: darkNormal)
    }

    static var washUIColor: UIColor {
        UIColor(red: bar.r, green: bar.g, blue: bar.b, alpha: washOpacity)
    }

    /// Solid page colour. Fills the gap around the floating pill so row text there is not readable.
    static var pageUIColor: UIColor {
        dynamic(light: lightPage, dark: darkPage)
    }

    static var separatorUIColor: UIColor {
        dynamic(light: lightSeparator, dark: darkSeparator)
    }

    private static func dynamic(light: RGB, dark: RGB) -> UIColor {
        UIColor { traits in
            (traits.userInterfaceStyle == .dark ? dark : light).uiColor
        }
    }
}
