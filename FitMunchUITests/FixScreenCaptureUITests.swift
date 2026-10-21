import XCTest

/// Recapture the build 11 fixes. Store shots stay on AppStoreScreenshotTests.
/// This run does not present the AI consent sheet.
final class FixScreenCaptureUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    func testPaywallUsesStoreKitPrices() {
        let app = launch([ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-ForceLightMode"])
        showTab("Me", in: app)
        let upgrade = app.buttons["settings-upgrade"]
        XCTAssertTrue(upgrade.waitForExistence(timeout: 12), "Upgrade missing")
        upgrade.tap()
        let monthly = app.descendants(matching: .any)["paywall-price-fitmunch_monthly"]
        let annual = app.descendants(matching: .any)["paywall-price-fitmunch_annual"]
        XCTAssertTrue(monthly.waitForExistence(timeout: 25), "Monthly price did not load")
        XCTAssertTrue(annual.waitForExistence(timeout: 8), "Annual price did not load")
        XCTAssertTrue(monthly.label.contains("19.99"), monthly.label)
        XCTAssertTrue(annual.label.contains("149.99"), annual.label)
        XCTAssertFalse(monthly.label.contains("12.99"), monthly.label)
        XCTAssertFalse(annual.label.contains("99.99"), annual.label)
        XCTAssertFalse(app.buttons["paywall-plan-fitmunch_weekly"].exists)
        XCTAssertFalse(app.staticTexts["ai-consent-sheet"].exists)
        shot(app, "paywall-plans")
        app.terminate()
    }

    func testScanBlockedDoesNotAskForCamera() {
        let app = launch([
            ReviewLaunchArgument.flag,
            AuditLaunchArgument.consentDenied,
            "-ForceLightMode",
        ])
        showTab("Scan", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["scan-consent-blocked"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["scan-take-photo"].exists)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let camera = springboard.alerts.matching(NSPredicate(format: "label CONTAINS[c] 'camera'")).firstMatch
        XCTAssertFalse(camera.waitForExistence(timeout: 2))
        XCTAssertFalse(app.descendants(matching: .any)["ai-consent-sheet"].exists)
        shot(app, "scan-blocked")
        app.terminate()
    }

    func testPlanOfflineHasOneVisibleCTA() {
        let app = launch([
            ReviewLaunchArgument.flag,
            AuditLaunchArgument.offline,
            "-ForceLightMode",
        ])
        showTab("Plan", in: app)
        let build = app.buttons["plan-generate"]
        XCTAssertTrue(build.waitForExistence(timeout: 8))
        XCTAssertEqual(build.label, "Build my week")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == 'Build my week'")).count, 1)
        XCTAssertFalse(app.buttons["Generate 7-day plan"].exists)
        XCTAssertTrue(build.isHittable)
        let tabTop = app.tabBars.firstMatch.frame.minY
        XCTAssertLessThan(build.frame.maxY, tabTop - 4)
        shot(app, "plan-offline")
        app.terminate()
    }

    func testTrainingEstimateIsNotOneMinute() {
        let app = launch([ReviewLaunchArgument.flag, "-ForceLightMode"])
        showTab("Plan", in: app)
        let training = app.buttons["Training"]
        XCTAssertTrue(training.waitForExistence(timeout: 8))
        training.tap()
        let estimates = app.staticTexts.matching(NSPredicate(format: "identifier == 'training-duration' OR label CONTAINS '· ~'"))
        XCTAssertTrue(estimates.firstMatch.waitForExistence(timeout: 6))
        XCTAssertFalse(app.staticTexts["Light to Moderate · ~1 min"].exists)
        var sawDerived = false
        for index in 0..<estimates.count {
            let label = estimates.element(boundBy: index).label
            XCTAssertFalse(label.contains("~1 min"), label)
            if label.contains("· ~") { sawDerived = true }
        }
        XCTAssertTrue(sawDerived)
        shot(app, "plan-training")
        app.terminate()
    }

    func testAboutClearsTheTabBar() {
        let app = launch([ReviewLaunchArgument.flag, "-ForceLightMode"])
        showTab("Me", in: app)
        let version = app.staticTexts["Version"]
        for _ in 0..<8 {
            if version.exists, version.isHittable, version.frame.minY > 80 {
                break
            }
            app.swipeUp()
        }
        XCTAssertTrue(version.waitForExistence(timeout: 4))
        XCTAssertFalse(app.staticTexts["March 2025"].exists)
        let tabTop = app.tabBars.firstMatch.frame.minY
        XCTAssertLessThan(version.frame.maxY, tabTop - 4, "About content sits under the tab bar")
        XCTAssertTrue(app.staticTexts["About"].exists)
        shot(app, "me-about")
        app.terminate()
    }

    func testTodayOfflineKeepsTheEmptyLine() {
        let app = launch([
            ReviewLaunchArgument.flag,
            AuditLaunchArgument.offline,
            "-ForceLightMode",
        ])
        showTab("Today", in: app)
        XCTAssertTrue(app.staticTexts["No meals logged today"].waitForExistence(timeout: 8))
        shot(app, "today-offline")
        app.terminate()
    }

    func testAuthErrorShowsTheServerSentence() {
        let app = launch(["-ForceLightMode"])
        XCTAssertTrue(app.staticTexts["Your AI health partner"].waitForExistence(timeout: 20))
        app.buttons["Sign In"].firstMatch.tap()
        let email = app.textFields["Email"]
        let password = app.secureTextFields["Password (min. 8 characters)"]
        XCTAssertTrue(email.waitForExistence(timeout: 6))
        email.tap()
        email.typeText("audit.not.a.user@fitmunch.com.au")
        password.tap()
        password.typeText("not-the-password")
        app.buttons["auth-sign-in"].tap()
        let error = app.descendants(matching: .any)["auth-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 15))
        XCTAssertTrue(error.label.localizedCaseInsensitiveContains("invalid"), error.label)
        XCTAssertFalse(error.label.localizedCaseInsensitiveContains("session expired"), error.label)
        shot(app, "auth-error")
        app.terminate()
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func showTab(_ name: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "Tab \(name) missing")
        button.tap()
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let device = (try? String(contentsOfFile: "/tmp/fitmunch-fix-device", encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "device"
        let folder = URL(fileURLWithPath: "/tmp/fitmunch-fix-capture/\(device)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("\(name).png")
        try? app.screenshot().pngRepresentation.write(to: url)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(device)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

enum AuditLaunchArgument {
    static let offline = "-AuditOffline"
    static let consentDenied = "-AuditConsentDenied"
}
