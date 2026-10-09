import XCTest
import UIKit

/// Native-feel checks: five tabs, light and dark shots, and the primary flows.
/// Screenshots land in /tmp/fitmunch-design-uitest/{light,dark}.
/// The CI script records the flow test with `xcrun simctl io recordVideo`.
final class DesignFeelUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.appearance = .light
    }

    func testTabScreenshotsLightAndDark() throws {
        let light = launch(
            arguments: [ScreenshotLaunchArgument.flag, "-ForceLightMode"],
            appearance: .light
        )
        captureTabs(in: light, folder: "light")
        light.terminate()

        let dark = launch(
            arguments: [ScreenshotLaunchArgument.flag, "-ForceDarkMode"],
            appearance: .dark
        )
        captureTabs(in: dark, folder: "dark")
        dark.terminate()

        for name in ["today", "plan", "scan", "coach", "me"] {
            assertShotsDiffer(name)
        }
    }

    func testPaywallShot() throws {
        capturePaywall(folder: "light", argument: "-ForceLightMode", appearance: .light)
        capturePaywall(folder: "dark", argument: "-ForceDarkMode", appearance: .dark)
        assertShotsDiffer("paywall")
    }

    func testLogScanPlanAndSwitchTabs() throws {
        let app = launch(
            arguments: [ScreenshotLaunchArgument.flag, "-ForceLightMode"],
            appearance: .light
        )
        signalRecording()
        assertFiveTabs(in: app)

        openTab("Today", in: app)
        let log = app.buttons["today-log-meal"]
        XCTAssertTrue(log.waitForExistence(timeout: 6))
        log.tap()

        let name = app.textFields["meal-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 6), "Meal name field missing")
        name.tap()
        name.typeText("Snack")
        dismissKeyboard(in: app)

        let manual = app.textFields["meal-manual-name"]
        XCTAssertTrue(manual.waitForExistence(timeout: 6), "Manual food field missing")
        XCTAssertTrue(app.staticTexts["Search coming soon"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.staticTexts["Chicken Breast"].exists, "Sample foods must not appear")
        XCTAssertFalse(app.buttons["food-Eggs"].exists)
        manual.tap()
        manual.typeText("Eggs")
        dismissKeyboard(in: app)

        let add = app.buttons["meal-add-manual"]
        XCTAssertTrue(add.waitForExistence(timeout: 6))
        if !add.isHittable {
            _ = scrollUntilHittable([add], in: app)
        }
        add.tap()

        let save = app.buttons["meal-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 4))
        save.tap()
        XCTAssertTrue(app.buttons["today-log-meal"].waitForExistence(timeout: 8), "Meal sheet did not close")

        openTab("Scan", in: app)
        dismissConsentIfNeeded(in: app)
        dismissSystemAlerts(in: app)
        let photo = app.buttons["scan-take-photo"]
        assertClearsTabBar(photo, named: "Take a photo", in: app)
        tapControl(photo)
        dismissCameraPermission()
        dismissConsentIfNeeded(in: app)
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

    private func capturePaywall(folder: String, argument: String, appearance: XCUIDevice.Appearance) {
        let review = launch(arguments: [ReviewLaunchArgument.flag, argument], appearance: appearance)
        openTab("Me", in: review)
        XCTAssertFalse(review.staticTexts["Alex Chen"].exists)
        XCTAssertFalse(review.staticTexts["Premium Subscriber"].exists)
        let upgrade = review.buttons["settings-upgrade"]
        XCTAssertTrue(upgrade.waitForExistence(timeout: 6))
        upgrade.tap()
        XCTAssertTrue(review.buttons["paywall-close"].waitForExistence(timeout: 10), "Paywall did not open")
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        saveDesignShot(review, folder: folder, name: "paywall")
        review.terminate()
    }

    private func captureTabs(in app: XCUIApplication, folder: String) {
        assertFiveTabs(in: app)
        let tabs = ["Today", "Plan", "Scan", "Coach", "Me"]
        for tab in tabs {
            openTab(tab, in: app)
            dismissSystemAlerts(in: app)
            settleAtTop(in: app)
            if tab == "Plan" {
                XCTAssertTrue(app.staticTexts["High protein training week"].waitForExistence(timeout: 6))
                XCTAssertTrue(
                    app.otherElements["plan-preview"].waitForExistence(timeout: 2)
                        || app.staticTexts["High protein training week"].exists,
                    "Plan preview is not on screen"
                )
            }
            if tab == "Me" {
                XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 4))
                XCTAssertTrue(app.staticTexts["Sample profile"].waitForExistence(timeout: 4))
                XCTAssertTrue(app.staticTexts["Premium"].waitForExistence(timeout: 4))
                XCTAssertFalse(app.staticTexts["Alex Chen"].exists)
                XCTAssertFalse(app.staticTexts["Premium Subscriber"].exists)
                XCTAssertFalse(app.staticTexts["No profile yet"].exists)
                assertClearsTabBar(marked("me-dark-mode", in: app), named: "Dark Mode", in: app)
            }
            if tab == "Today" {
                assertClearsTabBar(marked("today-rings", in: app), named: "Today rings", in: app)
            }
            if tab == "Plan" {
                assertClearsTabBar(app.buttons["plan-generate"], named: "Generate 7-day plan", in: app)
            }
            if tab == "Scan" {
                XCTAssertTrue(app.staticTexts["Scan your shop"].waitForExistence(timeout: 4))
                dismissConsentIfNeeded(in: app)
                dismissSystemAlerts(in: app)
                assertClearsTabBar(app.buttons["scan-take-photo"], named: "Take a photo", in: app)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.6))
            saveDesignShot(app, folder: folder, name: tab.lowercased())
        }
    }

    private func launch(arguments: [String], appearance: XCUIDevice.Appearance) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25))
        assertFullScreen(app)
        return app
    }

    private func assertFiveTabs(in app: XCUIApplication) {
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

    /// Screenshot launch pre-grants consent. If the sheet is still up, Allow it so Scan stays reachable.
    private func dismissConsentIfNeeded(in app: XCUIApplication) {
        let sheet = app.descendants(matching: .any)["ai-consent-sheet"]
        guard sheet.waitForExistence(timeout: 1.5) else { return }
        let allow = app.buttons["ai-consent-allow"]
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
        }
    }

    /// The system camera prompt is owned by SpringBoard, not the app alert.
    private func dismissCameraPermission() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 2) else { return }
        for title in ["Don’t Allow", "Don't Allow", "OK"] {
            let button = alert.buttons[title]
            if button.exists {
                button.tap()
                return
            }
        }
    }

    /// The tab bar container's minY sits below the floating glass. Use the tab buttons.
    private func assertClearsTabBar(_ element: XCUIElement, named name: String, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 8), "\(name) missing")
        let topLimit: CGFloat = 96
        let scroller = pageScroller(in: app)

        for _ in 0..<4 {
            if controlClearsChrome(element, in: app, topLimit: topLimit) {
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
        let barTop = tabButtonTop(in: app)
        XCTAssertTrue(
            controlClearsChrome(element, in: app, topLimit: topLimit),
            "\(name) is under the tab bar (control \(frame), hittable \(element.isHittable), tab buttons top \(barTop))"
        )
    }

    private func controlClearsChrome(_ element: XCUIElement, in app: XCUIApplication, topLimit: CGFloat) -> Bool {
        let frame = element.frame
        guard frame.width > 8, frame.height > 8 else { return false }
        return frame.minY >= topLimit && frame.maxY <= tabButtonTop(in: app) - 4
    }

    private func tabButtonTop(in app: XCUIApplication) -> CGFloat {
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

    private func assertFullScreen(_ app: XCUIApplication) {
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 8), "App window missing")
        let frame = window.frame
        print("DESIGN_WINDOW \(Int(frame.width.rounded()))x\(Int(frame.height.rounded()))")
        XCTAssertGreaterThan(frame.width, 400, "Window is letterboxed: \(frame)")
        XCTAssertGreaterThan(frame.height, 900, "Window is letterboxed: \(frame)")
    }

    private func marked(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func tapControl(_ element: XCUIElement) {
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func pageScroller(in app: XCUIApplication) -> XCUIElement {
        let scrolls = app.scrollViews.allElementsBoundByIndex.filter { $0.frame.height > 120 }
        if let tallest = scrolls.max(by: { $0.frame.height < $1.frame.height }) {
            return tallest
        }
        let lists = app.collectionViews.allElementsBoundByIndex.filter { $0.frame.height > 120 }
        if let tallest = lists.max(by: { $0.frame.height < $1.frame.height }) {
            return tallest
        }
        return app
    }

    private func drag(_ element: XCUIElement, from startY: CGFloat, to endY: CGFloat) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    /// Finger moves down, so a scrolled page returns to the top before the shot.
    private func settleAtTop(in app: XCUIApplication) {
        let scroller = pageScroller(in: app)
        if scroller.exists {
            drag(scroller, from: 0.32, to: 0.62)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    }

    private func dismissKeyboard(in app: XCUIApplication) {
        if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        }
    }

    /// The flow test blocks here so the CI script can start `recordVideo` after the
    /// app is up, instead of recording the springboard while xcodebuild launches.
    private func signalRecording() {
        let dir = URL(fileURLWithPath: "/tmp/fitmunch-design-uitest", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ready = dir.appendingPathComponent("app-ready")
        try? Data("ready".utf8).write(to: ready)
        let record = dir.appendingPathComponent("record-ready")
        let deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: record.path), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
    }

    private func saveDesignShot(_ app: XCUIApplication, folder: String, name: String) {
        var shot = app.windows.firstMatch.screenshot()
        if let image = UIImage(data: shot.pngRepresentation),
           (image.cgImage?.height ?? 0) < 2000 {
            shot = XCUIScreen.main.screenshot()
        }
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "\(folder)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)

        let data = shot.pngRepresentation
        assertFillsFrame(data, name: "\(folder)/\(name)")

        let dir = URL(fileURLWithPath: "/tmp/fitmunch-design-uitest/\(folder)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: dir.appendingPathComponent("\(name).png"))
        } catch {
            XCTFail("Could not write \(folder)/\(name).png: \(error)")
        }
    }

    private func assertShotsDiffer(_ name: String) {
        let lightURL = URL(fileURLWithPath: "/tmp/fitmunch-design-uitest/light/\(name).png")
        let darkURL = URL(fileURLWithPath: "/tmp/fitmunch-design-uitest/dark/\(name).png")
        guard let light = try? Data(contentsOf: lightURL), let dark = try? Data(contentsOf: darkURL) else {
            XCTFail("Missing light or dark screenshot \(name)")
            return
        }
        XCTAssertNotEqual(light, dark, "\(name) dark screenshot is pixel-identical to light")
    }

    private func assertFillsFrame(_ data: Data, name: String) {
        guard let image = UIImage(data: data), let cg = image.cgImage else {
            XCTFail("\(name) png unreadable")
            return
        }
        XCTAssertGreaterThan(cg.width, 1200, "\(name) is \(cg.width)x\(cg.height)")
        XCTAssertGreaterThan(cg.height, 2500, "\(name) is \(cg.width)x\(cg.height)")
        let top = blackFraction(image, yFraction: 0.08)
        let bottom = blackFraction(image, yFraction: 0.92)
        XCTAssertLessThan(top, 0.85, "\(name) top is letterboxed (black fraction \(top))")
        XCTAssertLessThan(bottom, 0.85, "\(name) bottom is letterboxed (black fraction \(bottom))")
    }

    /// Share of a horizontal strip that is pure black. Dark Surface is not pure black.
    private func blackFraction(_ image: UIImage, yFraction: CGFloat) -> Double {
        let width = 48
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: 1), format: format)
        let strip = renderer.image { _ in
            let y = image.size.height * image.scale * yFraction
            let drawHeight = image.size.height * image.scale
            image.draw(in: CGRect(x: 0, y: -y, width: CGFloat(width), height: drawHeight))
        }
        guard let cg = strip.cgImage,
              let bytes = cg.dataProvider?.data,
              let ptr = CFDataGetBytePtr(bytes) else { return 0 }
        let bpp = max(cg.bitsPerPixel / 8, 4)
        var black = 0
        let samples = min(width, cg.width)
        for x in 0..<samples {
            let o = x * bpp
            let channels = [ptr[o], ptr[o + 1], ptr[o + 2]]
            if channels.max() ?? 255 < 8 {
                black += 1
            }
        }
        return samples == 0 ? 0 : Double(black) / Double(samples)
    }
}
