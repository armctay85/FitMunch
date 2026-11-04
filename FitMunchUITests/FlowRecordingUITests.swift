import StoreKitTest
import XCTest

/// One pass for the CI screen recording: onboarding, the StoreKit paywall,
/// Today, a logged meal, then Plan, Scan, Coach, and Me.
/// The workflow starts `xcrun simctl io recordVideo` after `app-ready`.
final class FlowRecordingUITests: XCTestCase {
    private let readyDir = "/tmp/fitmunch-flow-recording"
    private var storeKit: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
        let url = try XCTUnwrap(
            Bundle(for: FlowRecordingUITests.self)
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
        XCTAssertEqual(created.storefront, "AUS", "Flow recording must use the AU storefront")
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
        XCTAssertFalse(price.label.contains("12.99"), "US storefront price is on the paywall")
        XCTAssertTrue(
            price.label.contains("A$") || price.label.contains("$"),
            "StoreKit displayPrice has no currency mark"
        )
        assertMonthlyPriceClearsAppleSentence(in: app)
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
        signInQA(in: app)
        XCTAssertFalse(app.staticTexts["Reviewer"].exists, "Me is still the Reviewer seed")
        XCTAssertTrue(app.staticTexts["FitMunch QA"].waitForExistence(timeout: 12), "QA account did not appear on Me")
        hold(1.6)
    }

    private func signInQA(in app: XCUIApplication) {
        if app.staticTexts["FitMunch QA"].waitForExistence(timeout: 2) { return }
        let email = qaValue("QA_EMAIL")
        let password = qaValue("QA_PASSWORD")
        XCTAssertFalse(email.isEmpty || password.isEmpty, "QA_EMAIL and QA_PASSWORD are not set")
        let logout = app.buttons["Log Out"].firstMatch
        var hops = 0
        while logout.exists, !logout.isHittable, hops < 6 {
            app.swipeUp()
            hops += 1
        }
        if logout.waitForExistence(timeout: 4) {
            logout.tap()
            let confirm = app.alerts.buttons["Log Out"]
            if confirm.waitForExistence(timeout: 4) {
                confirm.tap()
            }
        }
        let signInButton = app.buttons["Sign In"]
        if signInButton.waitForExistence(timeout: 8) {
            signInButton.tap()
        }
        let emailField = app.textFields["auth-email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 8), "Email field missing")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["auth-password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 4), "Password field missing")
        passwordField.tap()
        passwordField.typeText(password)
        if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        } else if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        }
        let submit = app.buttons["auth-sign-in"]
        XCTAssertTrue(submit.waitForExistence(timeout: 4), "Sign In button missing")
        submit.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 40), "QA sign-in did not reach the tabs")
        openTab("Me", in: app)
    }

    private func qaValue(_ key: String) -> String {
        let fromEnv = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !fromEnv.isEmpty { return fromEnv }
        let url = URL(fileURLWithPath: "/tmp/fitmunch-qa-credentials")
        guard key == "QA_EMAIL" || key == "QA_PASSWORD",
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        let lines = text.components(separatedBy: "\n")
        if key == "QA_EMAIL" { return lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        return lines.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func logAMeal(in app: XCUIApplication) {
        let log = app.buttons["today-log-meal"]
        XCTAssertTrue(log.waitForExistence(timeout: 8))
        log.tap()
        let mealName = app.textFields["meal-name"]
        XCTAssertTrue(mealName.waitForExistence(timeout: 8), "Meal name field missing")
        mealName.tap()
        clearField(mealName, in: app)
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
        let deadline = Date().addingTimeInterval(45)
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

    /// The log sheet prefills the time-of-day name. Typing without clearing
    /// turns Snack into SnackLunch.
    private func clearField(_ field: XCUIElement, in app: XCUIApplication) {
        guard let value = field.value as? String else { return }
        let existing = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !existing.isEmpty, existing != field.placeholderValue else { return }
        field.press(forDuration: 1.1)
        let selectAll = app.menuItems["Select All"]
        if selectAll.waitForExistence(timeout: 1.5) {
            selectAll.tap()
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            return
        }
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
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
