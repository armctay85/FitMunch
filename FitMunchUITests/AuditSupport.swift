import XCTest

enum ReviewLaunchArgument {
    static let flag = "-ReviewGuards"
}

extension XCTestCase {
    func firstExisting(_ queries: [XCUIElement], timeout: TimeInterval = 3) -> XCUIElement? {
        for query in queries where query.waitForExistence(timeout: timeout) {
            return query
        }
        return nil
    }

    func openTab(_ name: String, in app: XCUIApplication) {
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 8), "Tab bar missing before opening \(name)")
        let direct = bar.buttons[name]
        if direct.exists {
            direct.tap()
            return
        }
        let more = bar.buttons["More"]
        XCTAssertTrue(more.exists, "Tab '\(name)' is not in the bar and More is missing")
        more.tap()
        for candidate in [app.staticTexts[name], app.buttons[name], app.cells[name]]
        where candidate.waitForExistence(timeout: 3) {
            candidate.tap()
            return
        }
        XCTFail("Could not open tab \(name)")
    }

    func dismissSystemAlerts(in app: XCUIApplication) {
        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 1.2) else { return }
        for title in ["Don’t Allow", "Don't Allow", "Allow", "OK", "Close"] {
            let button = alert.buttons[title]
            if button.exists {
                button.tap()
                return
            }
        }
    }

    func attachScreen(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
