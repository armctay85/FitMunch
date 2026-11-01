import XCTest

/// Captures the real SwiftUI app for App Store 6.7" / 6.9" slots.
/// Launch argument `-AppStoreScreenshots` skips auth and paywall copy.
final class AppStoreScreenshotTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20), "Tab bar never appeared. Auth or onboarding leaked into screenshot mode.")
    }

    func testCaptureRequiredStoreScreens() throws {
        let screens: [(file: String, tab: String, proof: String)] = [
            ("home", "Today", "Today"),
            ("coach", "Coach", "Coach"),
            ("scan", "Scan", "Scan"),
            ("plan", "Plan", "Plan"),
            ("settings", "Me", "Me"),
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
                alignWholeMealCardsAboveTabBar()
            }
            savePNG(named: screen.file)
        }
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
            XCTAssertTrue(app.staticTexts["Alex Morgan"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["alex@example.com"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Sample"].exists)
            XCTAssertFalse(app.staticTexts["Sample profile"].exists)
            XCTAssertTrue(app.staticTexts["Premium"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Alex Chen"].exists)
            XCTAssertFalse(app.staticTexts["Premium Subscriber"].exists)
            XCTAssertFalse(app.staticTexts["Free Tier"].exists)
            XCTAssertFalse(app.buttons["Upgrade"].exists)
            XCTAssertFalse(app.buttons["Upgrade to Premium"].exists)
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
