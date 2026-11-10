import XCTest

/// Captures the real SwiftUI app for App Store 6.7" / 6.9" slots.
/// Launch argument `-AppStoreScreenshots` skips auth and paywall copy.
final class AppStoreScreenshotTests: XCTestCase {
    private var app: XCUIApplication!
    private let pricesVaryByStoreLine = "Prices vary by store and week."

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

    /// Me uses the Debug screenshot persona. It does not sign in as the QA account.
    func testCaptureSignedInMe() throws {
        let name = "Alex Morgan"
        let email = "alex.morgan@icloud.com"
        for token in ["QA", "test", "example", "+"] {
            XCTAssertFalse(name.localizedCaseInsensitiveContains(token), "persona name contains \(token)")
            XCTAssertFalse(email.localizedCaseInsensitiveContains(token), "persona email contains \(token)")
        }
        app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20), "Tab bar never appeared in screenshot mode.")
        openTab("Me")
        dismissSystemAlerts()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 12), "Store persona name did not appear on Me")
        XCTAssertTrue(app.staticTexts[email].waitForExistence(timeout: 4), "Store persona email did not appear on Me")
        XCTAssertFalse(app.staticTexts["FitMunch QA"].exists, "QA account name is on the Me shot")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "hello+qa")).firstMatch.exists,
            "QA mailbox is on the Me shot"
        )
        XCTAssertFalse(app.staticTexts["Sample"].exists)
        XCTAssertFalse(app.staticTexts["Sample profile"].exists)
        XCTAssertFalse(app.staticTexts["Demo"].exists)
        XCTAssertFalse(app.staticTexts["Reviewer"].exists)
        assertNoRejectedCopy(on: "settings")
        savePNG(named: "settings")
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
            assertPlanSummaryIsFullyVisible()
            assertPlanRowsRestAboveGenerate()
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

    /// plan.summary sits fully under the targets header. The 6.9 store shot
    /// was cutting that line to a fragment such as "from your calorie".
    private func assertPlanSummaryIsFullyVisible() {
        let summary = app.descendants(matching: .any)["plan-summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 4), "Plan summary missing")
        let prices = app.staticTexts[pricesVaryByStoreLine]
        XCTAssertTrue(prices.waitForExistence(timeout: 2), "Targets header missing")
        let generate = app.buttons["plan-generate"]
        XCTAssertTrue(generate.waitForExistence(timeout: 2), "Generate missing")
        let full = "Chicken, fish, yoghurt, and rice across the week. Built from your calorie and protein targets."
        XCTAssertEqual(summary.label, full, "Plan summary text is not the full sentence")
        let deadline = Date().addingTimeInterval(3)
        var frame = summary.frame
        while Date() < deadline {
            frame = summary.frame
            if frame.height > 32,
               frame.minY >= prices.frame.maxY - 1,
               frame.maxY <= generate.frame.minY {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertGreaterThan(frame.height, 32, "Plan summary is cut (frame \(frame))")
        XCTAssertGreaterThanOrEqual(
            frame.minY,
            prices.frame.maxY - 1,
            "Plan summary is cut under the targets header (summary \(frame), prices \(prices.frame))"
        )
        XCTAssertLessThanOrEqual(
            frame.maxY,
            generate.frame.minY,
            "Plan summary runs into Generate (summary \(frame), button \(generate.frame))"
        )
    }

    /// No drag. Every visible week line ends at least 8pt above the Generate fold.
    private func assertPlanRowsRestAboveGenerate() {
        let week = app.staticTexts["High protein training week"]
        let generate = app.buttons["plan-generate"]
        XCTAssertTrue(generate.waitForExistence(timeout: 4), "Generate missing")
        let fold = app.descendants(matching: .any)["plan-fold"]
        XCTAssertTrue(fold.waitForExistence(timeout: 4), "plan-fold missing")
        XCTAssertLessThan(fold.frame.minY, generate.frame.minY, "plan-fold is not above Generate")
        let limit = fold.frame.minY - 8
        guard let root = try? app.snapshot() else {
            XCTFail("Plan snapshot failed")
            return
        }
        var cut: (String, CGRect)?
        var mealCount = 0
        func walk(_ node: XCUIElementSnapshot) {
            if node.elementType == .staticText,
               node.frame.height > 8,
               node.frame.minY >= week.frame.minY - 1,
               node.frame.minY < fold.frame.minY {
                if node.label.contains("protein per serve") { mealCount += 1 }
                if node.frame.maxY > limit + 0.5, cut == nil {
                    cut = (node.label, node.frame)
                }
            }
            for child in node.children { walk(child) }
        }
        walk(root)
        XCTAssertNil(
            cut,
            "Plan at rest: '\(cut?.0 ?? "")' \(String(describing: cut?.1)) ends below the Generate fold minus 8pt (fold \(fold.frame.minY))"
        )
        XCTAssertGreaterThan(mealCount, 0, "Plan at rest shows no whole meal row")
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
            XCTAssertEqual(line.label, pricesVaryByStoreLine)
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
