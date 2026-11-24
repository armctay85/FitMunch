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

        let onboarding = launch([BrandAuditLaunch.onboarding])
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
        // iPad compatibility mode is a shorter window. The Dark Mode switch is
        // below the fold, and a List omits that row until it is scrolled in.
        _ = scrollUntilAnyExists([tabs.switches["me-dark-mode"]], in: tabs)
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
        let featureIds = (0..<4).map { "paywall-benefit-\($0)" }
        for identifier in featureIds {
            XCTAssertTrue(
                paywall.descendants(matching: .any)[identifier].waitForExistence(timeout: 6),
                "Feature row missing: \(identifier)"
            )
        }
        let annual = paywall.buttons["paywall-plan-fitmunch_annual"]
        XCTAssertTrue(annual.waitForExistence(timeout: 25), "Annual card missing")
        let laidOut = Date().addingTimeInterval(4)
        while Date() < laidOut && annual.frame.height < 20 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        save(paywall, name: "paywall")
        XCTAssertGreaterThanOrEqual(title.frame.minY, window.frame.minY - 1, "Headline is above the window")
        XCTAssertLessThanOrEqual(title.frame.maxY, window.frame.maxY + 1, "Headline is below the window")
        XCTAssertFalse(title.frame.intersects(annual.frame), "Annual card covers the headline \(title.frame) card \(annual.frame)")
        XCTAssertLessThanOrEqual(title.frame.maxY, annual.frame.minY + 1, "Annual card covers the headline")
        for identifier in featureIds {
            let row = paywall.descendants(matching: .any)[identifier]
            let frame = row.frame
            XCTAssertGreaterThan(frame.height, 8, "Feature row has no height: \(identifier)")
            XCTAssertGreaterThanOrEqual(frame.minY, window.frame.minY - 1, "\(identifier) starts above the window")
            XCTAssertLessThanOrEqual(frame.maxY, window.frame.maxY + 1, "\(identifier) runs below the window")
            XCTAssertFalse(frame.intersects(annual.frame), "Annual card covers \(identifier) \(frame) card \(annual.frame)")
            XCTAssertLessThanOrEqual(frame.maxY, annual.frame.minY + 1, "Annual card covers \(identifier)")
        }
        let annualPrice = paywall.staticTexts["paywall-price-fitmunch_annual"]
        XCTAssertTrue(annualPrice.waitForExistence(timeout: 4), "Annual price missing")
        XCTAssertTrue(
            annualPrice.label.contains("149.99"),
            "Annual price is not the AU catalog. \(annualPrice.label)"
        )
        XCTAssertFalse(annualPrice.label.contains("12.99"), "US storefront price is on the paywall. \(annualPrice.label)")
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

private enum BrandAuditLaunch {
    static let onboarding = "-AuditOnboarding"
}
