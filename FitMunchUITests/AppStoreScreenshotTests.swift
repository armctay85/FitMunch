import XCTest

/// Captures the real SwiftUI app for App Store 6.5" (1284x2778) and 6.9" (1320x2868) slots.
/// Launch argument `-AppStoreScreenshots` skips auth and paywall copy.
final class AppStoreScreenshotTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20), "Tab bar never appeared. Auth or onboarding leaked into screenshot mode.")
        XCTAssertTrue(
            app.descendants(matching: .any)["screenshot-ready"].firstMatch.waitForExistence(timeout: 8),
            "Screenshot window was not pinned before capture"
        )
    }

    func testCaptureRequiredStoreScreens() throws {
        let screens: [(file: String, tab: String, proof: String)] = [
            ("home", "Home", "Today"),
            ("coach", "Coach", "AI Coach"),
            ("scan", "Scan", "Receipt Scanner"),
            ("plan", "Meals", "Meal Plan"),
            ("settings", "Settings", "Settings"),
            ("workout", "Workout", "Workout"),
            ("history", "History", "History"),
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
            savePNG(named: screen.file)
        }
    }

    /// Timed walk for the 15 to 25 second App Preview. Same seven screens, no prices.
    func testWalkScreensForPreview() throws {
        let tabs = ["Scan", "Home", "Meals", "Coach", "Workout", "History", "Settings"]
        let dwell = previewDwell()
        for tab in tabs {
            openTab(tab)
            dismissSystemAlerts()
            assertNoRejectedCopy(on: tab)
            Thread.sleep(forTimeInterval: dwell)
        }
    }

    private func previewDwell() -> TimeInterval {
        for key in ["SCREENSHOT_DWELL", "TEST_RUNNER_SCREENSHOT_DWELL"] {
            if let raw = ProcessInfo.processInfo.environment[key], let value = Double(raw), value > 0 {
                return value
            }
        }
        return 2.4
    }

    private func assertScreenLooksInUse(_ screen: String) {
        switch screen {
        case "home":
            XCTAssertTrue(app.staticTexts["Breakfast"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Free limit reached"].exists)
        case "coach":
            XCTAssertTrue(app.staticTexts["What should I eat after training?"].waitForExistence(timeout: 4))
        case "scan":
            XCTAssertTrue(app.staticTexts["Weekly haul score"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Chicken breast"].waitForExistence(timeout: 4))
        case "plan":
            XCTAssertTrue(app.staticTexts["High protein training week"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Sunday"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Budget $"].exists)
        case "settings":
            XCTAssertTrue(app.staticTexts["Premium Subscriber"].waitForExistence(timeout: 4))
            XCTAssertFalse(app.staticTexts["Free Tier"].exists)
            XCTAssertFalse(app.buttons["Upgrade"].exists)
            XCTAssertFalse(app.buttons["Upgrade to Premium"].exists)
        case "workout":
            XCTAssertTrue(app.staticTexts["Weekly plan"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Full Body Foundation"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Daily steps"].waitForExistence(timeout: 4))
        case "history":
            XCTAssertTrue(app.staticTexts["Statistics"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Calorie Trends"].waitForExistence(timeout: 4))
            XCTAssertTrue(app.staticTexts["Breakfast"].waitForExistence(timeout: 4))
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

        let direct = bar.buttons[name]
        if direct.exists {
            direct.tap()
            return
        }

        let more = bar.buttons["More"]
        XCTAssertTrue(more.exists, "Tab '\(name)' is not in the bar and More is missing")
        more.tap()

        let candidates = [
            app.staticTexts[name],
            app.buttons[name],
            app.cells[name],
        ]
        for candidate in candidates where candidate.waitForExistence(timeout: 3) {
            candidate.tap()
            return
        }
        XCTFail("Could not open tab \(name) from More")
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
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "special")).firstMatch.exists,
            "\(screen) shows specials"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "catalogue")).firstMatch.exists,
            "\(screen) shows a catalogue"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "catalog")).firstMatch.exists,
            "\(screen) shows a catalog"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "saving")).firstMatch.exists,
            "\(screen) shows savings"
        )
    }

    /// Ask the capture script to take a simctl framebuffer shot, which is the full
    /// screen. XCUIScreen.screenshot letterboxes this app on the 6.7-inch sim.
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
