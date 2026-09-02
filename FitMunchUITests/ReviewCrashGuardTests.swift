import XCTest

/// Guideline 2.1 guards: Upgrade and Take a photo must not crash when
/// offerings are empty or the camera is missing (simulator / iPad).
final class ReviewCrashGuardTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag]
        app.launch()
        XCTAssertTrue(
            app.tabBars.firstMatch.waitForExistence(timeout: 20),
            "Tab bar never appeared under -ReviewGuards."
        )
    }

    func testUpgradeOpensPaywallWithoutCrashing() throws {
        openTab("Settings")
        let upgrade = firstExisting([
            app.buttons["settings-upgrade"],
            app.buttons["Upgrade"],
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
        ])
        XCTAssertNotNil(upgrade, "Upgrade control missing on Settings")
        upgrade?.tap()

        let paywallReady = app.otherElements["paywall-root"].waitForExistence(timeout: 8)
            || app.buttons["paywall-close"].waitForExistence(timeout: 2)
            || app.staticTexts["Unlock Premium Features"].waitForExistence(timeout: 2)
            || app.buttons["paywall-retry"].waitForExistence(timeout: 2)
        XCTAssertTrue(paywallReady, "Paywall did not appear after Upgrade")
        XCTAssertTrue(app.exists, "App died after Upgrade")
        XCTAssertFalse(app.staticTexts["Premium plans did not load from the App Store."].exists)
    }

    func testTakePhotoDoesNotCrashWhenCameraMissing() throws {
        openTab("Scan")
        let takePhoto = firstExisting([
            app.buttons["scan-take-photo"],
            app.buttons["Take a photo"],
        ])
        XCTAssertNotNil(takePhoto, "Take a photo missing on Scan")
        takePhoto?.tap()

        let recovered = app.alerts["Camera not available"].waitForExistence(timeout: 8)
            || app.buttons["scan-camera-cancel"].waitForExistence(timeout: 2)
            || app.buttons["Choose from library"].waitForExistence(timeout: 2)
        XCTAssertTrue(recovered, "Camera path showed neither a fallback alert nor camera chrome")
        XCTAssertTrue(app.exists, "App died after Take a photo")
    }

    private func firstExisting(_ queries: [XCUIElement]) -> XCUIElement? {
        for query in queries where query.waitForExistence(timeout: 3) {
            return query
        }
        return nil
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
        for candidate in [app.staticTexts[name], app.buttons[name], app.cells[name]]
        where candidate.waitForExistence(timeout: 3) {
            candidate.tap()
            return
        }
        XCTFail("Could not open tab \(name)")
    }
}

enum ReviewLaunchArgument {
    static let flag = "-ReviewGuards"
}
