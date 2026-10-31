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
            XCTAssertTrue(app.staticTexts["Sample profile"].waitForExistence(timeout: 4))
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

    /// Scroll Today so the last card above the tab bar is whole and flush with it.
    /// A card crossing the glass is a half-cut card. A gap under the last whole
    /// card is an empty band.
    private func alignWholeMealCardsAboveTabBar() {
        let scroll = tallestScroll()
        XCTAssertTrue(scroll.waitForExistence(timeout: 4), "Today scroll view missing")
        let topLimit: CGFloat = 96
        for _ in 0..<8 {
            let barTop = tabButtonTop(in: app)
            let cards = mealCards().sorted { $0.frame.minY < $1.frame.minY }
            if cards.isEmpty { break }

            if let cut = cards.first(where: { $0.frame.minY < barTop - 1 && $0.frame.maxY > barTop + 1 }) {
                let hidden = cut.frame.maxY - barTop
                let shown = barTop - cut.frame.minY
                let fitsAboveTitle = cut.frame.minY - hidden >= topLimit
                if shown >= hidden && fitsAboveTitle {
                    drag(scroll, points: -(hidden + 1))
                } else {
                    drag(scroll, points: shown + 1)
                }
                continue
            }

            let above = cards.filter { $0.frame.maxY <= barTop + 1 && $0.frame.minY >= topLimit }
            guard let last = above.max(by: { $0.frame.maxY < $1.frame.maxY }) else { break }
            let gap = barTop - last.frame.maxY
            if gap <= 8 { break }
            let room = last.frame.minY - topLimit
            let shift = min(gap, max(0, room))
            if shift <= 8 { break }
            drag(scroll, points: shift)
        }

        let barTop = tabButtonTop(in: app)
        let cards = mealCards().sorted { $0.frame.minY < $1.frame.minY }
        XCTAssertFalse(cards.isEmpty, "Today meal cards missing")
        let cut = cards.first { $0.frame.minY < barTop - 2 && $0.frame.maxY > barTop + 2 }
        XCTAssertNil(cut, "A meal card is cut by the tab bar \(cut?.frame ?? .zero) bar=\(barTop)")
        let whole = cards.filter { $0.frame.maxY <= barTop + 2 && $0.frame.minY >= topLimit }
        XCTAssertFalse(whole.isEmpty, "No whole meal card above the tab bar")
        if let last = whole.last {
            let gap = barTop - last.frame.maxY
            XCTAssertLessThanOrEqual(gap, 12, "Empty band under the last meal card \(last.frame) bar=\(barTop)")
        }
    }

    private func mealCards() -> [XCUIElement] {
        app.descendants(matching: .any)
            .matching(identifier: "today-meal-card")
            .allElementsBoundByIndex
            .filter { $0.frame.width > 80 && $0.frame.height > 40 }
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
