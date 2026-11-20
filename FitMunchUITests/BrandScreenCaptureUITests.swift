import XCTest

/// Brand screens for build 12. One pass writes auth, onboarding, today, plan,
/// paywall, and me. The workflow copies /tmp/fitmunch-b12-brand-shots after
/// each destination (iPhone 16e, then iPad Air 11-inch in compatibility mode).
final class BrandScreenCaptureUITests: XCTestCase {
    private let shotDir = "/tmp/fitmunch-b12-brand-shots"
    private let headline = "Eat to your goals with every shop"

    override func setUpWithError() throws {
        continueAfterFailure = false
        try FileManager.default.createDirectory(
            atPath: shotDir,
            withIntermediateDirectories: true
        )
    }

    func testCaptureBrandScreens() throws {
        let auth = launch([])
        XCTAssertTrue(
            auth.buttons["auth-create-account"].waitForExistence(timeout: 25)
                || auth.staticTexts["Your AI health partner"].waitForExistence(timeout: 5),
            "Auth did not appear"
        )
        save(auth, name: "auth")
        auth.terminate()

        let onboarding = launch([AuditLaunchArgument.onboarding])
        XCTAssertTrue(
            onboarding.staticTexts["Track Your Progress"].waitForExistence(timeout: 25),
            "Onboarding welcome did not appear"
        )
        save(onboarding, name: "onboarding")
        onboarding.terminate()

        let tabs = launch([ScreenshotLaunchArgument.flag])
        XCTAssertTrue(tabs.tabBars.firstMatch.waitForExistence(timeout: 25), "Tabs did not appear")
        openTab("Today", in: tabs)
        XCTAssertTrue(
            tabs.navigationBars["Today"].waitForExistence(timeout: 12)
                || tabs.staticTexts["Today"].waitForExistence(timeout: 4),
            "Today did not appear"
        )
        XCTAssertTrue(tabs.staticTexts["Breakfast"].waitForExistence(timeout: 8), "Today meals did not seed")
        save(tabs, name: "today")

        openTab("Plan", in: tabs)
        XCTAssertTrue(
            tabs.staticTexts["High protein training week"].waitForExistence(timeout: 12)
                || tabs.navigationBars["Plan"].waitForExistence(timeout: 4),
            "Plan did not appear"
        )
        save(tabs, name: "plan")

        openTab("Me", in: tabs)
        XCTAssertTrue(tabs.staticTexts["Progress"].waitForExistence(timeout: 12), "Me did not appear")
        XCTAssertTrue(tabs.switches["me-dark-mode"].waitForExistence(timeout: 6), "Dark Mode row missing")
        save(tabs, name: "me")
        tabs.terminate()

        let paywall = launch([ReviewLaunchArgument.flag])
        XCTAssertTrue(paywall.tabBars.firstMatch.waitForExistence(timeout: 25), "Paywall launch had no tabs")
        openUpgradePaywall(in: paywall)
        let title = paywall.staticTexts["paywall-headline"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "Paywall headline missing")
        XCTAssertEqual(title.label, headline)
        XCTAssertFalse(title.label.contains("…"), "Headline is truncated")
        let window = paywall.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 2))
        XCTAssertGreaterThanOrEqual(title.frame.minX, window.frame.minX - 1, "Headline starts outside the window")
        XCTAssertLessThanOrEqual(title.frame.maxX, window.frame.maxX + 1, "Headline runs outside the window")
        XCTAssertGreaterThan(title.frame.height, 20, "Headline has no height")
        if window.frame.width <= 430 {
            XCTAssertGreaterThan(title.frame.height, 44, "Headline did not wrap on a narrow window (\(window.frame.width))")
        }
        save(paywall, name: "paywall")
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func save(_ app: XCUIApplication, name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let url = URL(fileURLWithPath: shotDir).appendingPathComponent("\(name).png")
        do {
            try shot.pngRepresentation.write(to: url)
            print("BRAND_SHOT \(url.path)")
        } catch {
            XCTFail("Could not write \(name).png: \(error)")
        }
    }
}

enum AuditLaunchArgument {
    static let onboarding = "-AuditOnboarding"
}
