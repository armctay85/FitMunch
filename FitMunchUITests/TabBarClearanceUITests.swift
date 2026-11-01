import XCTest

/// Lowest primary control on each tab must be on screen and hittable.
/// The design job runs this on 6.9 (440x956) and 6.5 (414x896).
final class TabBarClearanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLowestPrimaryControlIsHittable() throws {
        let app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25))

        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 8))
        let width = window.frame.width
        let height = window.frame.height
        let is69 = abs(width - 440) < 3 && abs(height - 956) < 3
        let is65 = abs(width - 414) < 3 && abs(height - 896) < 3
        XCTAssertTrue(
            is69 || is65,
            "Expected 6.9 (440x956) or 6.5 (414x896). Window is \(width)x\(height)"
        )

        let controls: [(tab: String, identifier: String, type: XCUIElement.ElementType)] = [
            ("Today", "today-log-meal", .button),
            ("Plan", "plan-generate", .button),
            ("Scan", "scan-take-photo", .button),
            ("Coach", "coach-input", .textField),
            ("Me", "me-dark-mode", XCUIElement.ElementType.switch),
        ]

        for item in controls {
            openTab(item.tab, in: app)
            if item.identifier == "scan-take-photo" {
                revealScanPhoto(in: app)
            }
            let control = app.descendants(matching: item.type)[item.identifier]
            XCTAssertTrue(
                control.waitForExistence(timeout: 15),
                "\(item.identifier) \(item.type) missing on \(item.tab)"
            )
            if item.identifier == "plan-generate" {
                XCTAssertTrue(
                    control.isHittable,
                    "plan-generate is not hittable (\(Int(width.rounded()))x\(Int(height.rounded())))"
                )
            } else {
                let becameHittable = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "isHittable == true"),
                    object: control
                )
                if XCTWaiter.wait(for: [becameHittable], timeout: 6) != .completed {
                    _ = scrollUntilHittable([control], in: app)
                }
                XCTAssertTrue(
                    control.isHittable,
                    "\(item.identifier) is not hittable on \(item.tab) (\(Int(width.rounded()))x\(Int(height.rounded())))"
                )
            }
            let barTop = tabButtonTop(in: app)
            XCTAssertLessThanOrEqual(
                control.frame.maxY,
                barTop - 4,
                "\(item.identifier) sits under the tab bar (control \(control.frame), tab buttons top \(barTop))"
            )
            if item.identifier == "plan-generate" {
                assertMondayDinnerClearsGenerate(control, in: app)
            }
        }
    }

    /// Monday dinner is the row above Generate. Its frame has to end on or above the button.
    private func assertMondayDinnerClearsGenerate(_ generate: XCUIElement, in app: XCUIApplication) {
        let dinner = app.otherElements["plan-monday-dinner"]
        XCTAssertTrue(dinner.waitForExistence(timeout: 8), "Monday dinner missing")
        XCTAssertGreaterThan(dinner.frame.height, 8, "Monday dinner has no frame \(dinner.frame)")
        XCTAssertLessThanOrEqual(
            dinner.frame.maxY,
            generate.frame.minY,
            "Monday dinner ends under Generate (dinner \(dinner.frame), button \(generate.frame))"
        )
    }

    /// Screenshot launch already allows AI data. If the consent sheet is still up,
    /// allow it, then scroll so a short phone can reach Take a photo.
    private func revealScanPhoto(in app: XCUIApplication) {
        let photo = app.buttons["scan-take-photo"]
        if photo.waitForExistence(timeout: 2) { return }
        let allow = app.buttons["ai-consent-allow"]
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
        }
        var hops = 0
        while !photo.exists && hops < 3 {
            app.swipeUp()
            hops += 1
        }
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
}
