import XCTest

/// Native-feel checks: five tabs, light and dark shots, and the primary flows.
/// Screenshots land in /tmp/fitmunch-design-uitest/{light,dark}.
/// The CI script records the flow test with `xcrun simctl io recordVideo`.
final class DesignFeelUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
        app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.appearance = .light
        app = nil
    }

    func testTabScreenshotsLightAndDark() throws {
        assertFiveTabs()
        for appearance in [XCUIDevice.Appearance.light, XCUIDevice.Appearance.dark] {
            XCUIDevice.shared.appearance = appearance
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
            let folder = appearance == .dark ? "dark" : "light"
            let tabs = ["Today", "Plan", "Scan", "Coach", "Me"]
            for tab in tabs {
                openTab(tab, in: app)
                dismissSystemAlerts(in: app)
                if tab == "Plan" {
                    XCTAssertTrue(app.staticTexts["High protein training week"].waitForExistence(timeout: 6))
                }
                if tab == "Me" {
                    XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 4))
                    XCTAssertTrue(app.staticTexts["No profile yet"].waitForExistence(timeout: 4))
                    XCTAssertFalse(app.staticTexts["Alex Chen"].exists)
                    XCTAssertFalse(app.staticTexts["Premium Subscriber"].exists)
                }
                saveDesignShot(app, folder: folder, name: tab.lowercased())
                if tab == "Plan" {
                    assertClearsTabBar(app.buttons["plan-generate"], named: "Generate 7-day plan", in: app)
                }
                if tab == "Scan" {
                    assertClearsTabBar(app.buttons["scan-take-photo"], named: "Take a photo", in: app)
                }
            }
        }
    }

    func testPaywallShot() throws {
        app.terminate()
        let review = XCUIApplication()
        review.launchArguments = [ReviewLaunchArgument.flag]
        review.launch()
        XCTAssertTrue(review.tabBars.firstMatch.waitForExistence(timeout: 20))
        openTab("Me", in: review)
        XCTAssertFalse(review.staticTexts["Alex Chen"].exists)
        XCTAssertFalse(review.staticTexts["Premium Subscriber"].exists)
        let upgrade = review.buttons["settings-upgrade"]
        XCTAssertTrue(upgrade.waitForExistence(timeout: 6))
        upgrade.tap()
        XCTAssertTrue(review.buttons["paywall-close"].waitForExistence(timeout: 10), "Paywall did not open")
        saveDesignShot(review, folder: "light", name: "paywall")
    }

    func testLogScanPlanAndSwitchTabs() throws {
        assertFiveTabs()

        openTab("Today", in: app)
        let log = app.buttons["today-log-meal"]
        XCTAssertTrue(log.waitForExistence(timeout: 6))
        log.tap()

        let name = app.textFields["meal-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 6), "Meal name field missing")
        name.tap()
        name.typeText("Snack")
        if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        }

        let eggs = scrollUntilHittable([
            app.buttons["food-Eggs"],
            app.staticTexts["Eggs"],
        ], in: app)
        XCTAssertNotNil(eggs, "Eggs row missing")
        eggs?.tap()

        let add = app.buttons["meal-add-food"]
        XCTAssertTrue(add.waitForExistence(timeout: 6))
        add.tap()

        let save = app.buttons["meal-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 4))
        save.tap()
        XCTAssertTrue(app.buttons["today-log-meal"].waitForExistence(timeout: 8), "Meal sheet did not close")

        openTab("Scan", in: app)
        let photo = app.buttons["scan-take-photo"]
        assertClearsTabBar(photo, named: "Take a photo", in: app)
        tapControl(photo)
        if app.alerts["Camera not available"].waitForExistence(timeout: 8) {
            let alert = app.alerts["Camera not available"]
            if alert.buttons["OK"].exists {
                alert.buttons["OK"].tap()
            } else if alert.buttons["Choose from library"].exists {
                alert.buttons["Choose from library"].tap()
            }
        } else if app.buttons["scan-camera-cancel"].exists {
            app.buttons["scan-camera-cancel"].tap()
        }

        openTab("Plan", in: app)
        let generate = app.buttons["plan-generate"]
        assertClearsTabBar(generate, named: "Generate 7-day plan", in: app)
        tapControl(generate)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))

        for tab in ["Today", "Plan", "Scan", "Coach", "Me"] {
            openTab(tab, in: app)
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertFalse(app.tabBars.buttons["More"].exists)
    }

    private func assertFiveTabs() {
        let bar = app.tabBars.firstMatch
        for name in ["Today", "Plan", "Scan", "Coach", "Me"] {
            XCTAssertTrue(bar.buttons[name].exists, "Missing tab \(name)")
        }
        XCTAssertFalse(bar.buttons["More"].exists, "More tab should not exist")
        XCTAssertFalse(bar.buttons["Home"].exists)
        XCTAssertFalse(bar.buttons["Settings"].exists)
        XCTAssertFalse(bar.buttons["Workout"].exists)
        XCTAssertFalse(bar.buttons["History"].exists)
        XCTAssertFalse(bar.buttons["Meals"].exists)
    }

    /// A full swipeUp can park a top button under the nav bar. Nudge only when the
    /// frame actually overlaps the tab bar or the nav bar.
    private func assertClearsTabBar(_ element: XCUIElement, named name: String, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 8), "\(name) missing")
        let bar = app.tabBars.firstMatch
        XCTAssertGreaterThan(bar.frame.minY, 1, "Tab bar has no frame")
        let topLimit: CGFloat = 96
        let scroller = firstScroller(in: app)

        for _ in 0..<4 {
            if controlClearsChrome(element, bar: bar, topLimit: topLimit) {
                return
            }
            let frame = element.frame
            if frame.width > 8 && frame.minY < topLimit {
                drag(scroller, from: 0.42, to: 0.64)
            } else {
                drag(scroller, from: 0.68, to: 0.50)
            }
        }

        let frame = element.frame
        XCTAssertTrue(
            controlClearsChrome(element, bar: bar, topLimit: topLimit),
            "\(name) is not above the tab bar (control \(frame), hittable \(element.isHittable), tab \(bar.frame))"
        )
    }

    private func controlClearsChrome(_ element: XCUIElement, bar: XCUIElement, topLimit: CGFloat) -> Bool {
        let frame = element.frame
        guard frame.width > 8, frame.height > 8 else { return false }
        return frame.minY >= topLimit && frame.maxY <= bar.frame.minY + 1
    }

    private func tapControl(_ element: XCUIElement) {
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func firstScroller(in app: XCUIApplication) -> XCUIElement {
        let scroll = app.scrollViews.firstMatch
        if scroll.exists { return scroll }
        let list = app.collectionViews.firstMatch
        if list.exists { return list }
        return app
    }

    private func drag(_ element: XCUIElement, from startY: CGFloat, to endY: CGFloat) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func saveDesignShot(_ app: XCUIApplication, folder: String, name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "\(folder)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)

        let dir = URL(fileURLWithPath: "/tmp/fitmunch-design-uitest/\(folder)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try shot.pngRepresentation.write(to: dir.appendingPathComponent("\(name).png"))
        } catch {
            XCTFail("Could not write \(folder)/\(name).png: \(error)")
        }
    }
}
