import XCTest

/// StoreKit confirmation sheet. The FitMunchStoreKit scheme attaches
/// FitMunchProducts.storekit on both Run and Test. `-UseLocalStoreKit` only
/// skips RevenueCat so the live US storefront cannot replace those products.
final class PaywallPurchaseSheetTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOpensRevenueCatPurchaseSheet() throws {
        throw XCTSkip("RevenueCat purchase sheet is not used. StoreKit confirmation is testStoreKitConfirmationSheet.")
    }

    func testStoreKitConfirmationSheet() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag, "-UseLocalStoreKit"]
        app.launch()

        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Tab bar missing before paywall")
        XCTAssertFalse(app.alerts.firstMatch.exists, "Alert before the paywall: \(alertSummary(app))")
        openUpgradePaywall(in: app)

        let monthly = waitForPlanCard(app, id: "fitmunch_monthly", timeout: 25)
        let annual = waitForPlanCard(app, id: "fitmunch_annual", timeout: 25)
        XCTAssertNotNil(monthly, "Monthly plan missing. \(sheetSummary(app))")
        XCTAssertNotNil(annual, "Annual plan missing. \(sheetSummary(app))")
        assertStoreKitPrices(
            priceLabel(app, id: "fitmunch_monthly", fallback: monthly),
            annual: priceLabel(app, id: "fitmunch_annual", fallback: annual)
        )
        XCTAssertFalse(app.staticTexts["Day 12 we remind you"].exists)
        XCTAssertFalse(app.buttons["paywall-retry"].exists, "Retry state means StoreKit products did not load")
        XCTAssertFalse(app.alerts.firstMatch.exists, "Alert while plans were on screen: \(alertSummary(app))")

        let renewal = app.staticTexts["paywall-renewal"]
        XCTAssertTrue(renewal.waitForExistence(timeout: 4), "Renewal term missing from the bottom bar")
        XCTAssertTrue(renewal.label.contains("Renews automatically"), renewal.label)
        XCTAssertTrue(renewal.label.contains("149.99"), renewal.label)
        XCTAssertTrue(app.buttons["paywall-restore"].exists, "Restore Purchases missing")
        XCTAssertEqual(app.buttons["paywall-restore"].label, "Restore Purchases")

        let subscribe = app.buttons["paywall-subscribe"]
        XCTAssertTrue(subscribe.waitForExistence(timeout: 8), "Paywall subscribe button never appeared")
        XCTAssertTrue(subscribe.label.contains("14-day"), "Expected the 14-day trial CTA, got \(subscribe.label)")
        XCTAssertFalse(app.buttons["Continue on the web"].exists)
        XCTAssertFalse(app.staticTexts["Continue on the web"].exists)

        subscribe.tap()

        let control = waitForStoreKitConfirmation(app, timeout: 25)
        saveShot(name: "purchase-sheet")
        XCTAssertNotNil(control, "StoreKit confirmation sheet did not appear. \(sheetSummary(app))")
        XCTAssertFalse(app.alerts["Couldn't complete that"].exists, "Error alert instead of the StoreKit sheet: \(alertSummary(app))")
        XCTAssertFalse(app.staticTexts["Couldn't complete that"].exists)
        XCTAssertFalse(app.staticTexts["That plan is not available right now. Retry to reload App Store plans."].exists)
        let summary = sheetSummary(app)
        XCTAssertFalse(summary.contains("12.99"), "Purchase sheet used the live US monthly price. \(summary)")
        print("APP_FOREGROUND_SHOT purchase-sheet visible")
        XCTAssertEqual(app.state, .runningForeground)
        dismissPurchaseSheet(app)
    }

    private func priceLabel(_ app: XCUIApplication, id: String, fallback: XCUIElement?) -> String {
        let price = app.staticTexts["paywall-price-\(id)"]
        if price.exists { return price.label }
        return fallback?.label ?? ""
    }

    private func assertStoreKitPrices(_ monthly: String, annual: String) {
        XCTAssertTrue(monthly.contains("19.99"), "Monthly price was not the StoreKit product. \(monthly)")
        XCTAssertTrue(monthly.contains("/month"), "Monthly price is missing the period. \(monthly)")
        XCTAssertTrue(annual.contains("149.99"), "Annual price was not the StoreKit product. \(annual)")
        XCTAssertTrue(annual.contains("/year"), "Annual price is missing the period. \(annual)")
        XCTAssertFalse(monthly.contains("12.99"), "Monthly price was the live US storefront. \(monthly)")
        XCTAssertFalse(annual.contains("99.99"), "Annual price was the live US storefront. \(annual)")
    }

    /// The system confirmation has a Subscribe control that is not the paywall CTA.
    /// Any alert, including the old "Couldn't complete that" dialog, fails the test.
    private func waitForStoreKitConfirmation(_ app: XCUIApplication, timeout: TimeInterval) -> XCUIElement? {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for host in [app, springboard] {
                if host.alerts.firstMatch.exists {
                    let alert = host.alerts.firstMatch
                    if let control = purchaseControl(in: alert) {
                        return control
                    }
                    return nil
                }
                if let control = purchaseControl(in: host) {
                    return control
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return nil
    }

    /// Confirmation control from the StoreKit sheet. The paywall CTA keeps identifier paywall-subscribe.
    private func purchaseControl(in host: XCUIElement) -> XCUIElement? {
        let subscribe = host.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Subscribe' AND identifier != 'paywall-subscribe'")
        ).firstMatch
        if subscribe.exists { return subscribe }
        for label in ["Start Free Trial", "Confirm", "Purchase", "Buy"] {
            let button = host.buttons[label]
            if button.exists && button.identifier != "paywall-subscribe" {
                return button
            }
        }
        return nil
    }

    private func dismissPurchaseSheet(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for host in [springboard, app] {
            for label in ["Cancel", "Not Now", "Close"] {
                let button = host.buttons[label]
                if button.exists && button.identifier != "paywall-close" && button.isHittable {
                    button.tap()
                    return
                }
            }
        }
    }

    private func alertSummary(_ app: XCUIApplication) -> String {
        guard app.alerts.firstMatch.exists else { return "" }
        let alert = app.alerts.firstMatch
        let buttons = alert.buttons.allElementsBoundByIndex.map(\.label).joined(separator: " | ")
        return "\(alert.label) [\(buttons)]"
    }

    private func sheetSummary(_ app: XCUIApplication) -> String {
        let labels = app.buttons.allElementsBoundByIndex.prefix(16).map(\.label).joined(separator: " | ")
        return "Buttons: \(labels). \(alertSummary(app))"
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
        if let host = env["SIMULATOR_HOST_HOME"], !host.isEmpty {
            urls.append(
                URL(fileURLWithPath: host, isDirectory: true)
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
