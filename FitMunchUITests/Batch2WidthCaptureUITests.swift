import XCTest

/// Changed build 11 screens at 375pt and 440pt widths.
final class Batch2WidthCaptureUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testTodayEmptyOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-AuditTodayEmpty", "-ForceLightMode"])
        showTab("Today", in: app)
        XCTAssertTrue(app.staticTexts["No meals logged today"].waitForExistence(timeout: 12))
        shot(app, "today-empty")
        app.terminate()
    }

    func testMeAbout() {
        let app = launch(["-AppStoreScreenshots", "-ForceLightMode"])
        showTab("Me", in: app)
        XCTAssertTrue(app.staticTexts["Version"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.staticTexts["March 2025"].exists)
        shot(app, "me-about")
        app.terminate()
    }

    func testCoachPrivacyHandoff() {
        let app = launch(["-AuditConsentPrompt", "-ForceLightMode"])
        showTab("Coach", in: app)
        let suggestion = app.buttons["coach-suggestion"].firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 12))
        suggestion.tap()
        let notNow = app.buttons["ai-consent-not-now"]
        XCTAssertTrue(notNow.waitForExistence(timeout: 8))
        notNow.tap()
        let allow = app.buttons["coach-open-privacy"]
        XCTAssertTrue(allow.waitForExistence(timeout: 8))
        shot(app, "coach-blocked")
        allow.tap()
        let me = app.tabBars.buttons["Me"]
        let more = element("me-privacy-more", in: app)
        let deadline = Date().addingTimeInterval(8)
        var switched = false
        while Date() < deadline {
            if me.isSelected || more.exists || app.navigationBars["Me"].exists {
                switched = true
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTAssertTrue(switched, "Allow in Privacy did not open Me")
        if !more.waitForExistence(timeout: 3) {
            for _ in 0..<6 where !more.exists {
                app.swipeUp()
            }
        }
        XCTAssertTrue(more.waitForExistence(timeout: 6))
        let detail = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'The server keeps at most 20'")).firstMatch
        if !detail.waitForExistence(timeout: 2) {
            app.swipeUp()
        }
        XCTAssertTrue(detail.waitForExistence(timeout: 4))
        shot(app, "me-privacy")
        app.terminate()
    }

    func testScanOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-ForceLightMode"])
        showTab("Scan", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["scan-offline"].waitForExistence(timeout: 12))
        shot(app, "scan-offline")
        app.terminate()
    }

    func testScanFinishedOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-AuditScanFinished", "-ForceLightMode"])
        showTab("Scan", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["scan-result-offline"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["Weekly haul score"].waitForExistence(timeout: 4))
        shot(app, "scan-result-offline")
        app.terminate()
    }

    func testOnboardingCards() {
        let app = launch(["-AuditOnboarding", "-ForceLightMode"])
        XCTAssertTrue(app.staticTexts["Welcome to FitMunch"].waitForExistence(timeout: 15))
        app.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Set Your Goals"].waitForExistence(timeout: 6))
        shot(app, "onboarding-goals")
        app.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Choose Your Plan"].waitForExistence(timeout: 6))
        shot(app, "onboarding-plan")
        app.terminate()
    }

    func testPaywallInlineRestore() {
        let app = launch(["-ReviewGuards", "-PaywallForceEmpty", "-ForceLightMode"])
        showTab("Me", in: app)
        let upgrade = app.buttons["settings-upgrade"]
        XCTAssertTrue(upgrade.waitForExistence(timeout: 12))
        upgrade.tap()
        let restore = element("paywall-restore-inline", in: app)
        XCTAssertTrue(restore.waitForExistence(timeout: 25))
        var hops = 0
        while !restore.isHittable && hops < 5 {
            app.swipeUp()
            hops += 1
        }
        XCTAssertTrue(restore.isHittable)
        shot(app, "paywall-restore")
        app.terminate()
    }

    func testAuthErrorAX5() {
        let app = launch([
            "-AuditAuthError",
            "-ForceLightMode",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        let error = element("auth-error", in: app)
        XCTAssertTrue(error.waitForExistence(timeout: 12))
        let copy = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'invalid'")).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 4))
        shot(app, "auth-error-ax5")
        app.terminate()
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func showTab(_ name: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "Tab \(name) missing")
        button.tap()
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let device = (try? String(contentsOfFile: "/tmp/fitmunch-width-device", encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "device"
        let folder = URL(fileURLWithPath: "/tmp/fitmunch-width-capture/\(device)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("\(name).png")
        try? app.screenshot().pngRepresentation.write(to: url)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(device)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
