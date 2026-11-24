import XCTest

/// CI-1 proof. Selected only by workflow_dispatch force_fail. Other jobs
/// pass -only-testing for their own classes, so this does not run on a PR.
final class ForceFailEvidenceUITests: XCTestCase {
    func testForcedFailureEvidence() {
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag]
        app.launch()
        _ = app.tabBars.firstMatch.waitForExistence(timeout: 30)
        if app.tabBars.buttons["Me"].exists {
            app.tabBars.buttons["Me"].tap()
        }
        if app.buttons["settings-upgrade"].waitForExistence(timeout: 6) {
            app.buttons["settings-upgrade"].tap()
        }
        _ = app.buttons["paywall-close"].waitForExistence(timeout: 12)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "force-fail"
        attachment.lifetime = .keepAlways
        add(attachment)
        let tree = app.debugDescription
        let hierarchy = XCTAttachment(string: tree)
        hierarchy.name = "hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTFail("forced failure for CI evidence")
    }
}
