import XCTest

/// Captures the real SwiftUI app for App Store 6.7" / 6.9" slots.
/// Launch argument `-AppStoreScreenshots` skips auth and paywall copy.
final class AppStoreScreenshotTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCaptureRequiredStoreScreens() throws {
        app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20), "Tab bar never appeared. Auth or onboarding leaked into screenshot mode.")

        let screens: [(file: String, tab: String, proof: String)] = [
            ("home", "Today", "Today"),
            ("coach", "Coach", "Coach"),
            ("scan", "Scan", "Scan"),
            ("plan", "Plan", "Plan"),
        ]

        for screen in screens {
            openTab(screen.tab)
            dismissSystemAlerts()
            let appeared = app.navigationBars[screen.proof].waitForExistence(timeout: 8)
                || app.staticTexts[screen.proof].waitForExistence(timeout: 2)
                || (screen.file == "scan" && (
                    app.staticTexts["Scan your shop"].waitForExistence(timeout: 3)
                        || app.otherElements["scan-screen"].waitForExistence(timeout: 2)
                ))
            XCTAssertTrue(
                appeared,
                "Real SwiftUI screen '\(screen.proof)' did not appear for \(screen.file)"
            )
            assertScreenLooksInUse(screen.file)
            assertNoRejectedCopy(on: screen.file)
            if screen.file == "home" {
                logMealCards(where: "home")
                assertSummaryHeightDrop(on: app)
                alignWholeMealCardsAboveTabBar()
                logMealCards(where: "home-after-align")
            }
            savePNG(named: screen.file)
        }
    }

    /// Me is a real sign-in. Missing QA secrets skip only this capture.
    func testCaptureSignedInMe() throws {
        let email = qaValue("QA_EMAIL")
        let password = qaValue("QA_PASSWORD")
        try XCTSkipIf(
            email.isEmpty || password.isEmpty,
            "QA_EMAIL and QA_PASSWORD are not set. Skipping the Me capture only."
        )
        app = XCUIApplication()
        app.launchArguments = ["-ForceLightMode", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        signIn(email: email, password: password)
        openTab("Me")
        XCTAssertTrue(app.staticTexts["FitMunch QA"].waitForExistence(timeout: 12), "Signed-in name did not appear on Me")
        XCTAssertFalse(app.staticTexts["Sample"].exists)
        XCTAssertFalse(app.staticTexts["Sample profile"].exists)
        XCTAssertFalse(app.staticTexts["Demo"].exists)
        XCTAssertFalse(app.staticTexts["Alex Morgan"].exists)
        XCTAssertFalse(app.staticTexts["Reviewer"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'example.com'")).firstMatch.exists)
        assertNoRejectedCopy(on: "settings")
        savePNG(named: "settings")
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

    private func signIn(email: String, password: String, attempts: Int = 2) {
        let signInButton = app.buttons["Sign In"]
        if signInButton.waitForExistence(timeout: 15) {
            signInButton.tap()
        }
        let emailField = app.textFields["auth-email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 8), "Email field missing")
        emailField.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            emailField.tap()
        }
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
        if reachedTabs(in: app, submit: submit) { return }
        guard attempts > 0 else {
            XCTFail("Sign in did not reach the tabs")
            return
        }
        app.terminate()
        app.launch()
        signIn(email: email, password: password, attempts: attempts - 1)
    }

    /// A slow login stays on the auth screen with no error line. One extra tap, then give up.
    private func reachedTabs(in app: XCUIApplication, submit: XCUIElement) -> Bool {
        if app.tabBars.firstMatch.waitForExistence(timeout: 35) { return true }
        let error = app.staticTexts["auth-error"]
        if error.exists {
            print("AUTH_ERROR \(error.label)")
        }
        if submit.isHittable {
            submit.tap()
        }
        return app.tabBars.firstMatch.waitForExistence(timeout: 35)
    }

    private func assertScreenLooksInUse(_ screen: String) {
        switch screen {
        case "home":
            XCTAssertTrue(app.staticTexts["Breakfast"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Free limit reached"].exists)
        case "coach":
            XCTAssertTrue(app.staticTexts["What should I eat after training?"].waitForExistence(timeout: 4))
        case "scan":
            XCTAssertTrue(app.staticTexts["Scan your shop"].waitForExistence(timeout: 4))
        case "plan":
            XCTAssertTrue(app.staticTexts["High protein training week"].waitForExistence(timeout: 4))
        case "settings":
            break
        default:
            break
        }
    }

    private func dismissSystemAlerts() {
        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 1) else { return }
        for title in ["Don’t Allow", "Don't Allow", "Allow", "OK"] {
            let button = alert.buttons[title]
            if button.exists {
                button.tap()
                return
            }
        }
    }

    /// Both Daily Summary variants are measured at the same width. The short
    /// screen uses the compact one. The drop has to be at least 40pt.
    private func assertSummaryHeightDrop(on app: XCUIApplication) {
        let summary = app.descendants(matching: .any)["daily-summary-title"]
        XCTAssertTrue(summary.waitForExistence(timeout: 6), "Daily Summary missing")
        let deadline = Date().addingTimeInterval(6)
        var raw = "\(summary.value ?? "") \(summary.label)"
        while Date() < deadline {
            raw = "\(summary.value ?? "") \(summary.label)"
            if summaryDrop(in: raw) != nil { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        print("SUMMARY_HEIGHT \(raw)")
        let drop = summaryDrop(in: raw)
        XCTAssertNotNil(drop, "Daily Summary heights were not published: \(raw)")
        XCTAssertGreaterThanOrEqual(drop ?? 0, 40, "Compact Daily Summary dropped \(drop ?? 0)pt")
    }

    private func summaryDrop(in raw: String) -> Int? {
        func number(after key: String) -> Int? {
            guard let range = raw.range(of: key) else { return nil }
            let tail = raw[range.upperBound...]
            let digits = tail.prefix { $0.isNumber }
            return Int(digits)
        }
        guard let regular = number(after: "regular="), let compact = number(after: "compact=") else { return nil }
        guard regular > 0, compact > 0 else { return nil }
        return regular - compact
    }

    private func logMealCards(where place: String) {
        let window = app.windows.firstMatch
        let height = window.exists ? window.frame.height : 0
        print("MEAL_CARDS place=\(place) screen=\(Int(height.rounded()))")
        for card in mealCards() {
            let name = card.staticTexts["today-meal-name"]
            let title = name.exists ? name.label : card.label
            let frame = card.frame
            print(
                "MEAL_CARD name=\(title) minY=\(frame.minY) height=\(frame.height) maxY=\(frame.maxY)"
            )
        }
    }

    /// Park the lowest meal card that fits entirely above the tab buttons.
    /// The following card stays fully behind the bar. Chasing a smaller gap
    /// pulls that card back into a half cut, which is what the last run did.
    private func alignWholeMealCardsAboveTabBar() {
        let scroll = tallestScroll()
        XCTAssertTrue(scroll.waitForExistence(timeout: 4), "Today scroll view missing")
        let topLimit: CGFloat = 140
        for _ in 0..<6 {
            let barTop = floatingTabButtonTop(in: app)
            let cards = mealCards()
            // Lunch already sits on the bar on 6.7. Pulling Dinner up from there
            // opens a gap under the last whole card and the shot fails.
            if mealCardsAlreadyClearTabBar(cards, barTop: barTop, topLimit: topLimit) { break }
            guard let anchor = lowestCardThatFits(cards, barTop: barTop, topLimit: topLimit) else { break }
            let delta = barTop - anchor.frame.maxY
            if abs(delta) <= 8 { break }
            drag(scroll, points: max(-200, min(200, delta)))
        }

        let barTop = floatingTabButtonTop(in: app)
        let cards = mealCards()
        XCTAssertFalse(cards.isEmpty, "Today meal cards missing")
        let cut = cards.first { $0.frame.minY < barTop - 4 && $0.frame.maxY > barTop + 4 }
        XCTAssertNil(cut, "A meal card is cut by the tab bar \(String(describing: cut?.frame)) bar=\(barTop)")
        let whole = cards.filter { $0.frame.maxY <= barTop + 4 && $0.frame.minY >= topLimit - 8 }
        XCTAssertFalse(whole.isEmpty, "No whole meal card above the tab bar")
        if let last = whole.max(by: { $0.frame.maxY < $1.frame.maxY }) {
            let gap = barTop - last.frame.maxY
            XCTAssertLessThan(gap, 72, "Empty band under the last meal card \(last.frame) bar=\(barTop)")
        }
    }

    /// Same rule as the assertion below. A list that already passes must not be dragged.
    private func mealCardsAlreadyClearTabBar(_ cards: [XCUIElement], barTop: CGFloat, topLimit: CGFloat) -> Bool {
        let cut = cards.first { $0.frame.minY < barTop - 4 && $0.frame.maxY > barTop + 4 }
        if cut != nil { return false }
        let whole = cards.filter { $0.frame.maxY <= barTop + 4 && $0.frame.minY >= topLimit - 8 }
        guard let last = whole.max(by: { $0.frame.maxY < $1.frame.maxY }) else { return false }
        return barTop - last.frame.maxY < 72
    }

    /// Lowest card whose bottom can sit on the tab bar without sliding under the title.
    private func lowestCardThatFits(_ cards: [XCUIElement], barTop: CGFloat, topLimit: CGFloat) -> XCUIElement? {
        var fit: XCUIElement?
        for card in cards {
            let lift = max(0, card.frame.maxY - barTop)
            if card.frame.minY - lift >= topLimit {
                fit = card
            }
        }
        return fit
    }

    private func mealCards() -> [XCUIElement] {
        let raw = app.descendants(matching: .any)
            .matching(identifier: "today-meal-card")
            .allElementsBoundByIndex
            .filter { $0.frame.width > 80 && $0.frame.height > 40 }
            .sorted { $0.frame.minY < $1.frame.minY }
        var kept: [XCUIElement] = []
        for card in raw {
            if let last = kept.last, abs(card.frame.minY - last.frame.minY) < 12 {
                if card.frame.height > last.frame.height {
                    kept[kept.count - 1] = card
                }
                continue
            }
            kept.append(card)
        }
        return kept
    }

    private func tallestScroll() -> XCUIElement {
        let scrolls = app.scrollViews.allElementsBoundByIndex.filter { $0.frame.height > 120 }
        return scrolls.max(by: { $0.frame.height < $1.frame.height }) ?? app.scrollViews.firstMatch
    }

    /// points > 0 moves the finger down, so content moves down toward the tab bar.
    private func drag(_ element: XCUIElement, points: CGFloat) {
        let height = max(element.frame.height, 1)
        guard abs(points) > 1 else { return }
        let startY: CGFloat = points > 0 ? 0.38 : 0.72
        let endY = min(0.90, max(0.10, startY + points / height))
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func openTab(_ name: String) {
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        XCTAssertFalse(bar.buttons["More"].exists, "More tab is showing. Store shots use the five-tab bar.")
        let direct = bar.buttons[name]
        XCTAssertTrue(direct.waitForExistence(timeout: 5), "Tab '\(name)' is not on the tab bar")
        direct.tap()
    }

    private func assertNoRejectedCopy(on screen: String) {
        XCTAssertFalse(app.staticTexts["Free"].exists, "\(screen) shows Free")
        XCTAssertFalse(app.staticTexts["Free Tier"].exists, "\(screen) shows Free Tier")
        XCTAssertFalse(app.staticTexts["Free limit reached"].exists, "\(screen) shows a free-tier limit")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS '$'")).firstMatch.exists,
            "\(screen) shows a $ price"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "trial")).firstMatch.exists,
            "\(screen) shows trial copy"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "free")).firstMatch.exists,
            "\(screen) shows Free copy"
        )
        XCTAssertFalse(app.staticTexts["Paywall"].exists, "\(screen) shows a paywall")
        let priceLines = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Price")
        ).allElementsBoundByIndex
        XCTAssertLessThanOrEqual(priceLines.count, 1, "\(screen) repeats the price line")
        if let line = priceLines.first {
            XCTAssertEqual(line.label, "Prices vary by store and week.")
        }
    }

    private func savePNG(named name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        // Always write a known path. TEST_RUNNER_* env does not always reach XCTest on GHA.
        let dirs = [
            "/tmp/fitmunch-appstore-screenshots",
            ProcessInfo.processInfo.environment["SCREENSHOT_DIR"],
        ].compactMap { $0 }.filter { !$0.isEmpty }

        for dir in dirs {
            let folder = URL(fileURLWithPath: dir, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent("\(name).png")
                try screenshot.pngRepresentation.write(to: url)
                print("Wrote \(url.path)")
            } catch {
                XCTFail("Failed to write \(name).png to \(dir): \(error)")
            }
        }
    }
}

enum ScreenshotLaunchArgument {
    static let flag = "-AppStoreScreenshots"
}
