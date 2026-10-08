import SwiftUI

/// Shared colors from `public/css/fm-tokens.css`. Screens use these tokens
/// instead of a one-off RGB literal.
enum Theme {
    /// `--green` (#2bbf5a). Icons and highlights. White text on this green is 2.41:1.
    static let green = Color(red: 43.0 / 255.0, green: 191.0 / 255.0, blue: 90.0 / 255.0)

    /// Same hue as `green`, darkened so white label text is 5.42:1 (#167A36).
    static let buttonGreen = Color(red: 22.0 / 255.0, green: 122.0 / 255.0, blue: 54.0 / 255.0)

    /// Secondary copy on white. #595959 is 7.00:1 on white and 6.54:1 on the selected plan wash.
    static let secondaryText = Color(red: 89.0 / 255.0, green: 89.0 / 255.0, blue: 89.0 / 255.0)
}
