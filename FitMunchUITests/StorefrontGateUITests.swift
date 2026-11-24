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
        let monthly = app.staticTexts["paywall-price-fitmunch_monthly"]
        let annual = app.staticTexts["paywall-price-fitmunch_annual"]
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            let monthlyReady = monthly.exists && monthly.label.contains(where: { $0.isNumber })
            let annualReady = annual.exists && annual.label.contains(where: { $0.isNumber })
            if monthlyReady || annualReady {
                break
            }
            if app.staticTexts["Plans couldn't load. Check your connection and try again."].exists {
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        print("GATE_PRICE monthly=\(monthly.exists ? monthly.label : "missing") annual=\(annual.exists ? annual.label : "missing")")
        print("storefront gate finished")
    }
}
