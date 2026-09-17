import XCTest

/// PRE-ASC device audit rows A–E. Evidence class is CI macos Simulator / unit+UI.
/// Do not treat a pass here as a physical iPhone or iPad walk.
final class PreASCDeviceAuditTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag]
        app.launch()
    }

    /// A: App launches without crash.
    func testA_AppLaunchesWithoutCrash() throws {
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "App did not reach foreground")
        XCTAssertTrue(
            app.tabBars.firstMatch.waitForExistence(timeout: 20),
            "A FAIL: tab bar never appeared under -ReviewGuards"
        )
        XCTAssertTrue(app.exists, "A FAIL: process died after launch")
        attachScreen(app, name: "A-launch")
    }

    /// B: Scan → Take a photo uses SafeCameraPicker / library fallback, not a crash.
    func testB_ScanCameraOrLibraryDoesNotCrash() throws {
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openTab("Scan", in: app)
        XCTAssertTrue(
            app.staticTexts["Scan your shop"].waitForExistence(timeout: 8)
                || app.navigationBars["Receipt Scanner"].waitForExistence(timeout: 2),
            "B FAIL: Scan screen did not appear"
        )

        let library = firstExisting([
            app.buttons["scan-choose-library"],
            app.buttons["Choose from library"],
        ])
        XCTAssertNotNil(library, "B FAIL: Choose from library missing on Scan")

        let takePhoto = firstExisting([
            app.buttons["scan-take-photo"],
            app.buttons["Take a photo"],
        ])
        XCTAssertNotNil(takePhoto, "B FAIL: Take a photo missing on Scan")
        takePhoto?.tap()
        dismissSystemAlerts(in: app)

        let recovered = app.alerts["Camera not available"].waitForExistence(timeout: 10)
            || app.buttons["scan-camera-cancel"].waitForExistence(timeout: 2)
            || app.otherElements["scan-camera-root"].waitForExistence(timeout: 2)
            || app.buttons["Choose from library"].waitForExistence(timeout: 2)
        XCTAssertTrue(recovered, "B FAIL: neither SafeCameraPicker chrome nor library fallback appeared")
        XCTAssertTrue(app.exists, "B FAIL: app died after Take a photo")
        XCTAssertFalse(
            app.otherElements["UIImagePickerController"].exists,
            "B FAIL: UIImagePickerController appeared on the camera path"
        )
        attachScreen(app, name: "B-scan-camera")

        if app.alerts["Camera not available"].exists {
            let pick = app.alerts["Camera not available"].buttons["Choose from library"]
            if pick.exists {
                pick.tap()
            } else {
                app.alerts["Camera not available"].buttons["OK"].tap()
            }
        } else if app.buttons["scan-camera-cancel"].exists {
            app.buttons["scan-camera-cancel"].tap()
        }

        library?.tap()
        sleep(1)
        XCTAssertTrue(app.exists, "B FAIL: app died after Choose from library")
        attachScreen(app, name: "B-scan-library")
    }

    /// C/D: Upgrade opens paywall with plans or explicit Retry empty state.
    func testCD_UpgradeOpensPaywallPlansOrRetry() throws {
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openTab("Settings", in: app)
        let upgrade = firstExisting([
            app.buttons["settings-upgrade"],
            app.buttons["Upgrade"],
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
        ])
        XCTAssertNotNil(upgrade, "C/D FAIL: Upgrade control missing (free path broken)")
        upgrade?.tap()

        let paywallReady = app.otherElements["paywall-root"].waitForExistence(timeout: 10)
            || app.buttons["paywall-close"].waitForExistence(timeout: 2)
            || app.staticTexts["Unlock Premium Features"].waitForExistence(timeout: 2)
        XCTAssertTrue(paywallReady, "C/D FAIL: Paywall did not appear after Upgrade")
        XCTAssertTrue(app.exists, "C/D FAIL: app died after Upgrade")

        let outcome = waitForPaywallOutcome(timeout: 22)
        XCTAssertTrue(
            outcome == "plans" || outcome == "empty",
            "C/D FAIL: paywall stayed blank/loading (outcome=\(outcome))"
        )
        XCTAssertFalse(
            app.staticTexts["Premium plans did not load from the App Store."].exists,
            "C/D FAIL: old 2.1b dead-end copy is visible"
        )
        attachScreen(app, name: "CD-paywall")
    }

    /// E: Free path is reachable (reviewer is free; auth still offers Create Free Account).
    func testE_FreePathReachable() throws {
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openTab("Settings", in: app)
        let freeBadge = app.staticTexts["Free Tier"].waitForExistence(timeout: 6)
        let upgrade = firstExisting([
            app.buttons["settings-upgrade"],
            app.buttons["Upgrade"],
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
        ], timeout: 2)
        XCTAssertTrue(freeBadge || upgrade != nil, "E FAIL: neither Free Tier nor Upgrade is visible")
        XCTAssertFalse(app.staticTexts["Premium Subscriber"].exists, "E FAIL: ReviewGuards launched as premium")

        openTab("Home", in: app)
        XCTAssertTrue(
            app.staticTexts["Today"].waitForExistence(timeout: 6)
                || app.navigationBars["Today"].waitForExistence(timeout: 2),
            "E FAIL: Home/Today not reachable on the free path"
        )
        attachScreen(app, name: "E-free-signed-in")

        app.terminate()
        let fresh = XCUIApplication()
        fresh.launchArguments = []
        fresh.launch()
        let auth = fresh.buttons["Create Free Account"].waitForExistence(timeout: 12)
            || fresh.buttons["Sign In"].waitForExistence(timeout: 2)
            || fresh.staticTexts["Create Account"].waitForExistence(timeout: 2)
            || fresh.staticTexts["Your AI health partner"].waitForExistence(timeout: 2)
        XCTAssertTrue(auth, "E FAIL: unauthenticated launch did not show the free-account path")
        XCTAssertTrue(fresh.exists, "E FAIL: app died on unauthenticated launch")
        attachScreen(fresh, name: "E-free-auth")
    }

    private func waitForPaywallOutcome(timeout: TimeInterval) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if app.otherElements["paywall-plans"].exists
                || app.otherElements["paywall-plan-fitmunch_monthly"].exists
                || app.buttons["paywall-subscribe"].exists
                || app.staticTexts["Choose Your Plan"].exists {
                return "plans"
            }
            if app.buttons["paywall-retry"].exists
                || app.staticTexts["paywall-empty"].exists
                || app.staticTexts["Couldn't load App Store plans"].exists {
                return "empty"
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        }
        if app.otherElements["paywall-root"].exists || app.staticTexts["Unlock Premium Features"].exists {
            return "root-only"
        }
        return "missing"
    }
}
