import XCTest

/// The five tab buttons stay tappable. On 17 Pro Max the last Today card and
/// the last Me row, after scrolling to the end, finish at or above 857pt.
final class TabButtonCoverageUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testTabsHittableAndLastRowsClear() throws {
        let app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode"]
        app.launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 25), "Tab bar missing")

        let names = ["Today", "Plan", "Scan", "Coach", "Me"]
        for name in names {
            let button = bar.buttons[name]
            XCTAssertTrue(button.waitForExistence(timeout: 8), "\(name) tab button missing")
            XCTAssertTrue(button.isHittable, "\(name) tab button is covered")
            XCTAssertGreaterThan(button.frame.width, 20, "\(name) tab button has no hit area")
        }

        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 8))
        let width = window.frame.width
        let height = window.frame.height
        let is440 = abs(width - 440) < 3 && abs(height - 956) < 3
        let is375 = abs(width - 375) < 3
        XCTAssertTrue(
            is440 || is375,
            "Expected width 375 or 440. Window is \(width)x\(height)"
        )

        bar.buttons["Today"].tap()
        let lastCard = scrollToLastMealCard(in: app)
        let cardFrame = lastCard.frame
        XCTAssertGreaterThan(cardFrame.height, 40, "Last Today card has no frame")

        bar.buttons["Me"].tap()
        let lastRow = scrollToLastMeRow(in: app)
        let rowFrame = lastRow.frame
        XCTAssertGreaterThan(rowFrame.height, 20, "Last Me row has no frame")

        let lines = [
            "TAB_FRAME width=\(Int(width.rounded())) height=\(Int(height.rounded()))",
            "TAB_FRAME today-last maxY=\(cardFrame.maxY) minY=\(cardFrame.minY) height=\(cardFrame.height)",
            "TAB_FRAME me-last maxY=\(rowFrame.maxY) minY=\(rowFrame.minY) height=\(rowFrame.height)",
        ]
        for line in lines {
            print(line)
        }
        writeFrames(lines, width: width)

        if is440 {
            XCTAssertLessThanOrEqual(
                cardFrame.maxY,
                857,
                "Last Today card ends below 857pt (\(cardFrame))"
            )
            XCTAssertLessThanOrEqual(
                rowFrame.maxY,
                857,
                "Last Me row ends below 857pt (\(rowFrame))"
            )
        }
    }

    private func scrollToLastMealCard(in app: XCUIApplication) -> XCUIElement {
        XCTAssertTrue(app.staticTexts["Breakfast"].waitForExistence(timeout: 12), "Today meals did not load")
        let scroller = app.scrollViews.firstMatch
        var previous = CGFloat.greatestFiniteMagnitude
        var last = mealCards(in: app).last
        for _ in 0..<8 {
            let cards = mealCards(in: app)
            if let bottom = cards.last {
                if abs(bottom.frame.maxY - previous) < 1 {
                    last = bottom
                    break
                }
                previous = bottom.frame.maxY
                last = bottom
            }
            if scroller.exists {
                scroller.swipeUp()
            } else {
                app.swipeUp()
            }
        }
        let cards = mealCards(in: app)
        XCTAssertFalse(cards.isEmpty, "Today meal card missing")
        return cards.last ?? last!
    }

    /// Sorted top to bottom. An empty query must not call allElementsBoundByIndex.
    private func mealCards(in app: XCUIApplication) -> [XCUIElement] {
        let query = app.descendants(matching: .any).matching(identifier: "today-meal-card")
        guard query.firstMatch.exists else { return [] }
        return query.allElementsBoundByIndex.sorted { $0.frame.minY < $1.frame.minY }
    }

    private func scrollToLastMeRow(in app: XCUIApplication) -> XCUIElement {
        let scroller = app.scrollViews.firstMatch
        var row = app.buttons["settings-delete-account"]
        var hops = 0
        while !row.exists, hops < 8 {
            if scroller.exists {
                scroller.swipeUp()
            } else {
                app.swipeUp()
            }
            hops += 1
            row = app.buttons["settings-delete-account"]
        }
        XCTAssertTrue(row.waitForExistence(timeout: 4), "Delete Account row missing")
        var previous = CGFloat.greatestFiniteMagnitude
        for _ in 0..<6 {
            if abs(row.frame.maxY - previous) < 1 { break }
            previous = row.frame.maxY
            if scroller.exists {
                scroller.swipeUp()
            } else {
                app.swipeUp()
            }
        }
        return row
    }

    private func writeFrames(_ lines: [String], width: CGFloat) {
        let dir = URL(fileURLWithPath: "/tmp/fitmunch-width-capture", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let text = lines.joined(separator: "\n") + "\n"
        let name = "frames-\(Int(width.rounded())).txt"
        try? Data(text.utf8).write(to: dir.appendingPathComponent(name))
    }
}
