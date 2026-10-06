import XCTest

/// StoreKit-only paywall. The FitMunchStoreKit scheme attaches FitMunchProducts.storekit.
/// `-UseLocalStoreKit` skips RevenueCat so CI cannot paint the live US storefront
/// ($99.99 / $12.99). The RevenueCat purchase-sheet assertion is quarantined: that
/// sheet does not present when RevenueCat is not configured for the simulator.
/// A StoreKit test sheet is accepted when the configuration file supplies a product.
final class PaywallPurchaseSheetTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testStoreKitPaywallUsesLocalCatalog() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag, "-UseLocalStoreKit"]
        app.launch()

        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Tab bar missing before paywall")
        openUpgradePaywall(in: app)

        let monthly = waitForPlanCard(app, id: "fitmunch_monthly", timeout: 25)
        let annual = waitForPlanCard(app, id: "fitmunch_annual", timeout: 25)
        XCTAssertNotNil(monthly, "Monthly plan missing. \(sheetSummary(app))")
        XCTAssertNotNil(annual, "Annual plan missing. \(sheetSummary(app))")
        assertLocalCatalog(
            priceLabel(app, id: "fitmunch_monthly", fallback: monthly),
            annual: priceLabel(app, id: "fitmunch_annual", fallback: annual)
        )

        let subscribe = scrollUntilHittable([app.buttons["paywall-subscribe"]], in: app)
        XCTAssertNotNil(subscribe, "Paywall subscribe button never appeared")
        XCTAssertTrue(subscribe?.label.contains("14-day") == true, "Expected the 14-day trial CTA, got \(subscribe?.label ?? "")")
        XCTAssertFalse(app.buttons["Continue on the web"].exists)
        XCTAssertFalse(app.staticTexts["Continue on the web"].exists)

        subscribe?.tap()

        let sheet = waitForPurchaseSheet(app, timeout: 20)
        XCTAssertEqual(app.state, .runningForeground)
        saveShot(name: "purchase-sheet")
        print("APP_FOREGROUND_SHOT purchase-sheet \(sheet ? "visible" : "in-app")")
        if sheet {
            let summary = sheetSummary(app)
            XCTAssertFalse(summary.contains("99.99"), "Purchase sheet used the live US annual price. \(summary)")
            XCTAssertFalse(summary.contains("12.99"), "Purchase sheet used the live US monthly price. \(summary)")
            dismissPurchaseSheet(app)
        } else {
            // No RevenueCat sheet, and no StoreKit product handle when the
            // simulator ignores the configuration file. Purchase stays in-app.
            XCTAssertFalse(app.buttons["Continue on the web"].exists)
            XCTAssertFalse(app.staticTexts["Continue on the web"].exists)
            let summary = sheetSummary(app)
            XCTAssertFalse(summary.contains("99.99"), "Live US annual price after subscribe. \(summary)")
            XCTAssertFalse(summary.contains("12.99"), "Live US monthly price after subscribe. \(summary)")
            let stillHere = app.buttons["paywall-subscribe"].exists
                || app.buttons["paywall-close"].exists
                || app.alerts.firstMatch.exists
            XCTAssertTrue(stillHere, "Subscribe left the StoreKit paywall. \(summary)")
        }
    }

    private func priceLabel(_ app: XCUIApplication, id: String, fallback: XCUIElement?) -> String {
        let price = app.staticTexts["paywall-price-\(id)"]
        if price.exists { return price.label }
        return fallback?.label ?? ""
    }

    private func assertLocalCatalog(_ monthly: String, annual: String) {
        XCTAssertTrue(monthly.contains("19.99"), "Monthly price was not the StoreKit catalog. \(monthly)")
        XCTAssertTrue(annual.contains("149.99"), "Annual price was not the StoreKit catalog. \(annual)")
        XCTAssertFalse(monthly.contains("12.99"), "Monthly price was the live US storefront. \(monthly)")
        XCTAssertFalse(annual.contains("99.99"), "Annual price was the live US storefront. \(annual)")
    }

    private func waitForPurchaseSheet(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if purchaseControl(in: app) != nil || purchaseControl(in: springboard) != nil {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        return false
    }

    /// System purchase confirmation. The paywall CTA keeps identifier paywall-subscribe.
    private func purchaseControl(in host: XCUIApplication) -> XCUIElement? {
        let subscribe = host.buttons.matching(
            NSPredicate(format: "label == 'Subscribe' AND identifier != 'paywall-subscribe'")
        ).firstMatch
        if subscribe.exists { return subscribe }
        for label in ["Start Free Trial", "Confirm", "Purchase"] {
            let button = host.buttons[label]
            if button.exists { return button }
        }
        for label in ["Confirm Purchase", "Confirm Subscription", "Subscription Confirmation"] {
            let text = host.staticTexts[label]
            if text.exists { return text }
        }
        return nil
    }

    private func dismissPurchaseSheet(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for host in [app, springboard] {
            for label in ["Cancel", "Close", "Not Now"] {
                let button = host.buttons[label]
                if button.exists {
                    button.tap()
                    return
                }
            }
        }
    }

    private func sheetSummary(_ app: XCUIApplication) -> String {
        let labels = app.buttons.allElementsBoundByIndex.prefix(12).map(\.label).joined(separator: " | ")
        return "Buttons: \(labels)"
    }

    private func saveShot(name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        var urls = [URL(fileURLWithPath: "/tmp/fitmunch-b10-screenshots", isDirectory: true)]
        let env = ProcessInfo.processInfo.environment
        if let shared = env["SIMULATOR_SHARED_RESOURCES_DIRECTORY"], !shared.isEmpty {
            urls.append(
                URL(fileURLWithPath: shared, isDirectory: true)
                    .appendingPathComponent("fitmunch-b10-screenshots", isDirectory: true)
            )
        }
        let data = shot.pngRepresentation
        for dir in urls {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("\(name).png")
            try? data.write(to: url)
            print("FULLSCREEN_SHOT \(url.path)")
        }
    }
}
