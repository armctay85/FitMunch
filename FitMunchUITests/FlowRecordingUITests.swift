import XCTest

/// One pass for the CI screen recording: onboarding, the StoreKit paywall,
/// Today, a logged meal, then Plan, Scan, Coach, and Me.
/// The workflow starts `xcrun simctl io recordVideo` after `app-ready`.
final class FlowRecordingUITests: XCTestCase {
    private let readyDir = "/tmp/fitmunch-flow-recording"

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
    }

    func testMainFlowsForRecording() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AuditOnboarding",
            "-UseLocalStoreKit",
            "-ForceLightMode",
        ]
        app.launch()

        XCTAssertTrue(
            app.staticTexts["Welcome to FitMunch"].waitForExistence(timeout: 25),
            "Onboarding welcome did not appear"
        )
        signalRecording()
        hold(1.5)

        let next = app.buttons["onboarding-next"]
        XCTAssertTrue(next.waitForExistence(timeout: 6))
        next.tap()

        let name = app.textFields["Your Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 8), "Name field missing")
        name.tap()
        name.typeText("Alex")
        let email = app.textFields["Email Address"]
        XCTAssertTrue(email.waitForExistence(timeout: 4), "Email field missing")
        email.tap()
        email.typeText("alex@example.com")
        dismissKeyboard(in: app)
        next.tap()

        let premium = app.descendants(matching: .any)["onboarding-plan-premium"]
        XCTAssertTrue(premium.waitForExistence(timeout: 8), "Plan step missing")
        hold(1.2)
        if !premium.isHittable {
            app.swipeUp()
        }
        premium.tap()

        XCTAssertTrue(app.buttons["paywall-close"].waitForExistence(timeout: 12), "Paywall did not open")
        let price = waitForStoreKitPrice(in: app)
        XCTAssertFalse(price.label.isEmpty, "StoreKit price label was empty")
        hold(2.5)
        app.buttons["paywall-close"].tap()

        let start = app.buttons["onboarding-get-started"]
        XCTAssertTrue(start.waitForExistence(timeout: 8))
        start.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 12), "Today did not appear after onboarding")
        hold(1.5)

        logAMeal(in: app)
        hold(1.2)

        openTab("Plan", in: app)
        hold(1.6)
        openTab("Scan", in: app)
        allowConsentIfNeeded(in: app)
        dismissSystemAlerts(in: app)
        hold(1.6)
        openTab("Coach", in: app)
        allowConsentIfNeeded(in: app)
        hold(1.6)
        openTab("Me", in: app)
        hold(1.6)
    }

    private func logAMeal(in app: XCUIApplication) {
        let log = app.buttons["today-log-meal"]
        XCTAssertTrue(log.waitForExistence(timeout: 8))
        log.tap()
        let mealName = app.textFields["meal-name"]
        XCTAssertTrue(mealName.waitForExistence(timeout: 8), "Meal name field missing")
        mealName.tap()
        mealName.typeText("Lunch")
        dismissKeyboard(in: app)
        let manual = app.textFields["meal-manual-name"]
        XCTAssertTrue(manual.waitForExistence(timeout: 6), "Manual food field missing")
        if !manual.isHittable {
            app.swipeUp()
        }
        manual.tap()
        manual.typeText("Eggs")
        dismissKeyboard(in: app)
        let add = app.buttons["meal-add-manual"]
        XCTAssertTrue(add.waitForExistence(timeout: 6))
        if !add.isHittable {
            app.swipeUp()
        }
        add.tap()
        let save = app.buttons["meal-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 6))
        if !save.isHittable {
            app.swipeUp()
        }
        save.tap()
        XCTAssertTrue(app.buttons["today-log-meal"].waitForExistence(timeout: 10), "Meal sheet did not close")
    }

    private func waitForStoreKitPrice(in app: XCUIApplication) -> XCUIElement {
        let ids = ["paywall-price-fitmunch_monthly", "paywall-price-fitmunch_annual"]
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            for id in ids {
                let element = app.staticTexts[id]
                if element.exists, element.label.contains(where: { $0.isNumber }) {
                    return element
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTFail("StoreKit displayPrice did not appear on the paywall")
        return app.staticTexts[ids[0]]
    }

    private func allowConsentIfNeeded(in app: XCUIApplication) {
        let sheet = app.descendants(matching: .any)["ai-consent-sheet"]
        guard sheet.waitForExistence(timeout: 2) else { return }
        let allow = app.buttons["ai-consent-allow"]
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
        }
    }

    private func dismissKeyboard(in app: XCUIApplication) {
        if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        }
    }

    private func signalRecording() {
        let dir = URL(fileURLWithPath: readyDir, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? Data("ready".utf8).write(to: dir.appendingPathComponent("app-ready"))
        let record = dir.appendingPathComponent("record-ready")
        let deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: record.path), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
    }

    private func hold(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}
