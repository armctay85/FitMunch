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
                if tab == "Scan" {
                    let photo = app.buttons["scan-take-photo"]
                    assertClearsTabBar(photo, named: "Take a photo", in: app)
                }
                if tab == "Me" {
                    XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 4))
                }
                saveDesignShot(app, folder: folder, name: tab.lowercased())
            }
        }
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
        photo.tap()
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
        generate.tap()
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

    private func assertClearsTabBar(_ element: XCUIElement, named name: String, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 8), "\(name) missing")
        let bar = app.tabBars.firstMatch
        var nudges = 0
        while !element.isHittable && nudges < 3 {
            app.swipeUp()
            nudges += 1
        }
        XCTAssertTrue(element.isHittable, "\(name) is not hittable")
        XCTAssertGreaterThan(bar.frame.minY, 1, "Tab bar has no frame")
        XCTAssertLessThanOrEqual(
            element.frame.maxY,
            bar.frame.minY + 1,
            "\(name) sits under the tab bar (control bottom \(element.frame.maxY), tab top \(bar.frame.minY))"
        )
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
