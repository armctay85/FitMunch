import XCTest

/// Attempts a real StoreKit fetch of fitmunch_monthly and fitmunch_annual.
/// This class must run on FitMunchSandboxProbe, which has no .storekit configuration.
/// A pass does not mean products loaded. The report file says whether they did.
final class SandboxProductProbeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSandboxFetchOfLiveProductIDs() throws {
        XCTAssertEqual(
            auditMode(),
            "sandbox",
            "Sandbox probe must run on the scheme without FitMunchProducts.storekit"
        )
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag, "-SandboxProductProbe"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Sandbox probe: tab bar missing")
        openUpgradePaywall(in: app)

        let probe = app.staticTexts["sandbox-probe-summary"]
        XCTAssertTrue(probe.waitForExistence(timeout: 8), "Sandbox probe: summary missing")
        let deadline = Date().addingTimeInterval(40)
        var label = probe.label
        while !label.contains("probe:loaded=") && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            label = probe.label
        }
        XCTAssertTrue(label.contains("probe:loaded="), "Sandbox probe: fetch never finished (\(label))")

        let loaded = label.contains("fitmunch_monthly") && label.contains("fitmunch_annual")
            && !label.contains("loaded=none")
        if loaded {
            let card = waitForPlanCard(app, id: "fitmunch_monthly", timeout: 8)
            XCTAssertTrue(
                card != nil || app.otherElements["paywall-plans"].exists,
                "Sandbox probe: summary says products loaded but the paywall has no plans (\(label))"
            )
        } else {
            XCTAssertTrue(
                app.staticTexts["Plans couldn't load. Check your connection and try again."].waitForExistence(timeout: 8)
                    || app.buttons["paywall-retry"].exists,
                "Sandbox probe: products did not load and the retry state is missing"
            )
        }
        XCTAssertEqual(app.state, .runningForeground, "Sandbox probe: app crashed")
        let shot = saveAuditScreen(app, baseName: "sandbox-paywall")

        let device = auditDeviceSlug()
        let body = """
        sandbox_fetch=attempted
        device=\(device)
        product_ids=fitmunch_monthly,fitmunch_annual
        storekit_configuration=none
        real_sandbox_products_loaded=\(loaded ? "yes" : "no")
        probe_summary=\(label)
        screenshot=\(shot)
        note=This process does not attach FitMunchProducts.storekit. Prices here would be live App Store or sandbox products. CI simulators are not signed into a sandbox Apple ID, so no is the honest result unless the label lists the product IDs.
        """
        let url = URL(fileURLWithPath: "/tmp/pre-asc-audit/sandbox-fetch-\(device).txt")
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try body.write(to: url, atomically: true, encoding: .utf8)
    }
}
