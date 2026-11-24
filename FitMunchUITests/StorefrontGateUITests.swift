import XCTest

/// CI-4: open the paywall before any other UI assertion so the app log
/// prints Storefront.current. The workflow greps that line.
final class StorefrontGateUITests: XCTestCase {
    func testStorefrontIsAUS() {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag]
        app.launch()
        _ = app.tabBars.firstMatch.waitForExistence(timeout: 30)
        if app.tabBars.buttons["Me"].exists {
            app.tabBars.buttons["Me"].tap()
        }
        if app.buttons["settings-upgrade"].waitForExistence(timeout: 8) {
            app.buttons["settings-upgrade"].tap()
        } else if app.buttons["Upgrade"].exists {
            app.buttons["Upgrade"].tap()
        }
        _ = app.buttons["paywall-close"].waitForExistence(timeout: 20)
        let deadline = Date().addingTimeInterval(25)
        let prices = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'paywall-price-'"))
        while Date() < deadline {
            if prices.firstMatch.exists {
                break
            }
            if app.staticTexts["Plans couldn't load. Check your connection and try again."].exists {
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        print("storefront gate finished")
    }
}
