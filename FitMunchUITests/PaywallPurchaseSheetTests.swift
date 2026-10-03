import XCTest

/// Opens the paywall and taps subscribe so the RevenueCat / StoreKit purchase sheet appears.
/// Run with the FitMunchStoreKit scheme, which attaches FitMunchProducts.storekit.
final class PaywallPurchaseSheetTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOpensRevenueCatPurchaseSheet() throws {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag]
        app.launch()

        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Tab bar missing before paywall")
        openUpgradePaywall(in: app)

        let subscribe = app.buttons["paywall-subscribe"]
        XCTAssertTrue(subscribe.waitForExistence(timeout: 25), "Paywall subscribe button never appeared")
        XCTAssertTrue(subscribe.isHittable, "Subscribe button is not hittable")
        subscribe.tap()

        let sheet = waitForPurchaseSheet(app, timeout: 25)
        XCTAssertEqual(app.state, .runningForeground)
        saveShot(name: "purchase-sheet")
        print("APP_FOREGROUND_SHOT purchase-sheet \(sheet ? "visible" : "missing")")
        XCTAssertTrue(sheet, "RevenueCat purchase sheet did not appear. \(sheetSummary(app))")
        dismissPurchaseSheet(app)
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
