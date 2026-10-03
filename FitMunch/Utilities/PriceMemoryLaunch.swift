import Foundation

/// Seeded price memory screens for pull-request simulator shots and UI tests.
/// Never used for the App Store screenshot set (`-AppStoreScreenshots` hides this).
enum PriceMemoryLaunch {
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("-PriceMemory") }
    }

    static var forceDark: Bool { has("-PriceMemoryDark") }
    static var showEmpty: Bool { has("-PriceMemoryEmpty") }
    static var showData: Bool { has("-PriceMemoryData") }
    static var openSettings: Bool { has("-PriceMemorySettings") }
    static var showSaved: Bool { has("-PriceMemoryScanSaved") }
    static var showOptIn: Bool { has("-PriceMemoryScanOptIn") }

    static var initialTab: Int? {
        if showSaved || showOptIn { return 2 }
        if openSettings { return 6 }
        if showEmpty || showData { return 3 }
        return isActive ? 3 : nil
    }

    static var priceCount: Int { showEmpty ? 0 : 4 }

    static func has(_ flag: String) -> Bool {
        ProcessInfo.processInfo.arguments.contains(flag)
    }
}
