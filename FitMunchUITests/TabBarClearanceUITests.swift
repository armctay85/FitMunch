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

        let controls: [(tab: String, identifier: String)] = [
            ("Today", "today-log-meal"),
            ("Plan", "plan-generate"),
            ("Scan", "scan-take-photo"),
            ("Coach", "coach-input"),
            ("Me", "me-dark-mode"),
        ]

        for item in controls {
            openTab(item.tab, in: app)
            let control = primaryControl(item.identifier, in: app)
            XCTAssertTrue(
                control.waitForExistence(timeout: 8),
                "\(item.identifier) missing on \(item.tab)"
            )
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
            let barTop = tabButtonTop(in: app)
            XCTAssertLessThanOrEqual(
                control.frame.maxY,
                barTop - 4,
                "\(item.identifier) sits under the tab bar (control \(control.frame), tab buttons top \(barTop))"
            )
        }
    }

    private func primaryControl(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let queries = [
            app.buttons[identifier],
            app.textFields[identifier],
            app.textViews[identifier],
            app.switches[identifier],
            app.descendants(matching: .any)[identifier],
        ]
        return queries.first { $0.exists } ?? queries[0]
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
