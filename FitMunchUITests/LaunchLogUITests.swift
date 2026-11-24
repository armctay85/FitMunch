import XCTest

/// One fresh launch that reaches the paywall. The CI job records the
/// RevenueCat and FitMunch logs around this test. The offering has to load.
final class LaunchLogUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchReachesPaywallOffering() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag, "-LaunchPaywall"]
        app.launch()
        let headline = app.staticTexts["paywall-headline"]
        XCTAssertTrue(headline.waitForExistence(timeout: 30), "Paywall did not appear")
        let annual = app.staticTexts["paywall-price-fitmunch_annual"]
        let monthly = app.staticTexts["paywall-price-fitmunch_monthly"]
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if annual.exists, !annual.label.isEmpty { break }
            if monthly.exists, !monthly.label.isEmpty { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertTrue(
            (annual.exists && !annual.label.isEmpty) || (monthly.exists && !monthly.label.isEmpty),
            "Offering did not load a plan price"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(2))
    }
}
