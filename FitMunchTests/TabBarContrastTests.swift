import XCTest
@testable import FitMunch

/// Tab icons and labels stay at or above 4.5:1 on the bar wash.
final class TabBarContrastTests: XCTestCase {
    func testIconsAndLabelsClearFourPointFive() {
        let lightCard = TabBarContrast.composite(TabBarContrast.lightPage, over: TabBarContrast.white)
        let darkCard = TabBarContrast.composite(TabBarContrast.darkPage, over: TabBarContrast.darkCard)
        let cases: [(String, TabBarContrast.RGB, TabBarContrast.RGB)] = [
            ("selected on light page", TabBarContrast.lightSelected, TabBarContrast.lightPage),
            ("selected on light card", TabBarContrast.lightSelected, lightCard),
            ("selected on dark page", TabBarContrast.darkSelected, TabBarContrast.darkPage),
            ("selected on dark card", TabBarContrast.darkSelected, darkCard),
            ("label on light page", TabBarContrast.lightNormal, TabBarContrast.lightPage),
            ("label on light card", TabBarContrast.lightNormal, lightCard),
            ("label on dark page", TabBarContrast.darkNormal, TabBarContrast.darkPage),
            ("label on dark card", TabBarContrast.darkNormal, darkCard),
        ]
        for (name, ink, back) in cases {
            let ratio = TabBarContrast.ratio(ink, on: back)
            XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(name) contrast is \(ratio)")
        }
    }

    func testWashOpacityStaysNearOpaque() {
        XCTAssertEqual(TabBarContrast.washOpacity, 0.94, accuracy: 0.0001)
    }
}
