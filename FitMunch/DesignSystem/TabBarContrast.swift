import UIKit

/// Colours for the floating tab bar and the WCAG contrast of its icons and labels.
/// The wash is the page background at 0.98 over the material, so row text behind
/// the bar is not readable. Selected green matches the BrandGreen asset.
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

    /// BrandGreen light, #15803D-class. White is not drawn on this green here.
    static let lightSelected = RGB(r: 0.082, g: 0.502, b: 0.239)
    /// BrandGreen dark.
    static let darkSelected = RGB(r: 0.133, g: 0.773, b: 0.369)
    /// Secondary text #5F6B64.
    static let lightNormal = RGB(r: 95.0 / 255.0, g: 107.0 / 255.0, b: 100.0 / 255.0)
    /// Secondary text on the dark page.
    static let darkNormal = RGB(r: 197.0 / 255.0, g: 208.0 / 255.0, b: 200.0 / 255.0)
    /// Page background #F4F6F2.
    static let lightPage = RGB(r: 244.0 / 255.0, g: 246.0 / 255.0, b: 242.0 / 255.0)
    /// Page background #101A14.
    static let darkPage = RGB(r: 16.0 / 255.0, g: 26.0 / 255.0, b: 20.0 / 255.0)
    /// Hairline #D9DED9.
    static let lightSeparator = RGB(r: 217.0 / 255.0, g: 222.0 / 255.0, b: 217.0 / 255.0)
    /// Hairline #26302A.
    static let darkSeparator = RGB(r: 38.0 / 255.0, g: 48.0 / 255.0, b: 42.0 / 255.0)
    static let white = RGB(r: 1, g: 1, b: 1)
    /// Dark card, lifted off the page.
    static let darkCard = RGB(r: 22.0 / 255.0, g: 32.0 / 255.0, b: 26.0 / 255.0)

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
        UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? darkPage : lightPage
            return UIColor(red: rgb.r, green: rgb.g, blue: rgb.b, alpha: washOpacity)
        }
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
