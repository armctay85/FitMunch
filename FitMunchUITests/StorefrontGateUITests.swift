import StoreKitTest
import XCTest

/// CI-4: the paywall prices are asserted inside this test. An SKTestSession in
/// this process is what has put the AU catalog into the launched app on these
/// runners. The workflow treats this assertion as the pass signal.
final class StorefrontGateUITests: XCTestCase {
    private var storeKit: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        // workflow_dispatch broken_session injects this into the test runner only.
        // Normal runs leave it unset and still start the AU session below.
        let brokenSession = ProcessInfo.processInfo.environment["FITMUNCH_BROKEN_SESSION"] == "1"
            || ProcessInfo.processInfo.arguments.contains("-FITMUNCH_BROKEN_SESSION")
        if brokenSession {
            print("GATE_BROKEN_SESSION no SKTestSession")
            return
        }
        let url = try XCTUnwrap(
            Bundle(for: StorefrontGateUITests.self)
                .url(forResource: "FitMunchProducts", withExtension: "storekit"),
            "FitMunchProducts.storekit is not in the UI test bundle"
        )
        let created = try SKTestSession(contentsOf: url)
        created.disableDialogs = true
        created.resetToDefaultState()
        created.clearTransactions()
        created.storefront = "AUS"
        created.locale = Locale(identifier: "en_AU")
        storeKit = created
    }

    override func tearDownWithError() throws {
        storeKit = nil
    }

    func testPricesWithoutLocalStoreKit() {
        assertAustraliaPrices(useLocalStoreKit: false)
    }

    func testPricesWithLocalStoreKit() {
        assertAustraliaPrices(useLocalStoreKit: true)
    }

    /// US prices fail this. A$149.99 does not count as 99.99: the pattern
    /// requires 12.99 or 99.99 not preceded by a digit or a dot.
    private func assertAustraliaPrices(useLocalStoreKit: Bool) {
        let app = XCUIApplication()
        var args = [ReviewLaunchArgument.flag]
        if useLocalStoreKit {
            args.append("-UseLocalStoreKit")
        }
        app.launchArguments = args
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
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            let monthlyReady = monthly.exists && monthly.label.contains(where: { $0.isNumber })
            let annualReady = annual.exists && annual.label.contains(where: { $0.isNumber })
            if monthlyReady && annualReady {
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        let monthlyLabel = monthly.exists ? monthly.label : "missing"
        let annualLabel = annual.exists ? annual.label : "missing"
        let flag = useLocalStoreKit ? "on" : "off"
        print("GATE_PRICE flag=\(flag) monthly=\(monthlyLabel) annual=\(annualLabel)")
        let joined = monthlyLabel + "\n" + annualLabel
        XCTAssertTrue(monthlyLabel.contains("19.99"), "monthly GATE_PRICE flag=\(flag) \(monthlyLabel)")
        XCTAssertTrue(annualLabel.contains("149.99"), "annual GATE_PRICE flag=\(flag) \(annualLabel)")
        XCTAssertFalse(joined.range(of: "(^|[^0-9.])(12\\.99|\\b99\\.99)\\b", options: .regularExpression) != nil, "US price 12.99 GATE_PRICE flag=\(flag) \(joined)")
    }
}
