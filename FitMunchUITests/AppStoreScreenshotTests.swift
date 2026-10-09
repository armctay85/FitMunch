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
            assertStoreSafe(on: screen.file)
            waitForSettledFrame(screen.file)
            savePNG(named: screen.file)
        }
    }

    /// Consent is pre-granted by ScreenshotLaunch. The sheet, and any Grok or Google line, must not be in the shot.
    private func assertStoreSafe(on screen: String) {
        XCTAssertFalse(
            app.descendants(matching: .any)["ai-consent-sheet"].exists,
            "\(screen) is showing the AI consent sheet"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "grok")).firstMatch.exists,
            "\(screen) shows Grok"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "google")).firstMatch.exists,
            "\(screen) shows Google"
        )
    }

    /// The shared tab-bar inset is measured after the first layout. Wait until pinned controls clear it.
    private func waitForSettledFrame(_ screen: String) {
        switch screen {
        case "scan":
            let photo = app.buttons.matching(
                NSPredicate(format: "identifier == 'scan-take-photo' OR label == 'Take a photo'")
            ).firstMatch
            assertClearsTabBar(photo, named: "Take a photo")
        case "plan":
            assertClearsTabBar(app.buttons["plan-generate"], named: "Generate 7-day plan")
        case "coach":
            let input = app.textFields["coach-input"].exists
                ? app.textFields["coach-input"]
                : app.descendants(matching: .any)["coach-input"]
            assertClearsTabBar(input, named: "Coach composer")
        default:
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }
    }

    private func assertClearsTabBar(_ element: XCUIElement, named name: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 8), "\(name) missing before the shot")
        let deadline = Date().addingTimeInterval(8)
        var barTop = tabButtonTop()
        while Date() < deadline {
            barTop = tabButtonTop()
            if element.exists,
               element.isHittable,
               element.frame.height > 1,
               element.frame.maxY <= barTop - 4 {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTAssertLessThanOrEqual(
            element.frame.maxY,
            barTop - 4,
            "\(name) sits under the tab bar (control \(element.frame), tab buttons top \(barTop))"
        )
    }

    private func tabButtonTop() -> CGFloat {
        let bar = app.tabBars.firstMatch
        var top = bar.frame.minY
        for name in ["Today", "Plan", "Scan", "Coach", "Me"] {
            let button = bar.buttons[name]
            if button.exists, button.frame.height > 1 {
                top = min(top, button.frame.minY)
            }
        }
        return top
    }

    private func assertScreenLooksInUse(_ screen: String) {
        switch screen {
        case "home":
            XCTAssertTrue(app.staticTexts["Breakfast"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Free limit reached"].exists)
        case "coach":
            XCTAssertTrue(app.staticTexts["Build me a high-protein week for my macros"].waitForExistence(timeout: 4))
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

    /// Ask the capture script to take a simctl framebuffer shot, which is the full
    /// screen. XCUIScreen.screenshot letterboxes this app.
    private func waitForFramebufferShot(named name: String) -> Bool {
        let readyRoot = "/tmp/fitmunch-shot-ready"
        let ack = "/tmp/fitmunch-shot-ack/\(name)"
        do {
            try FileManager.default.createDirectory(atPath: readyRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(atPath: "/tmp/fitmunch-shot-ack", withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: "\(readyRoot)/\(name)", contents: Data())
        } catch {
            return false
        }
        let start = Date()
        while !FileManager.default.fileExists(atPath: ack), Date().timeIntervalSince(start) < 20 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return FileManager.default.fileExists(atPath: ack)
    }

    private func savePNG(named name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        // The shell waiter writes the real framebuffer PNG when it acks.
        // Fall back to XCUIScreen only if that waiter is not running.
        if waitForFramebufferShot(named: name) {
            print("Framebuffer shot acked for \(name)")
            return
        }

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
