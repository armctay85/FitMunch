import XCTest

/// Changed build 11 screens at 375pt and 440pt widths.
final class Batch2WidthCaptureUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testTodayEmptyOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-AuditTodayEmpty", "-ForceLightMode"])
        showTab("Today", in: app)
        XCTAssertTrue(app.staticTexts["No meals logged today"].waitForExistence(timeout: 12))
        shot(app, "today-empty")
        app.terminate()
    }

    func testMeAbout() {
        let app = launch(["-AppStoreScreenshots", "-ForceLightMode"])
        showTab("Me", in: app)
        XCTAssertTrue(app.staticTexts["Version"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.staticTexts["March 2025"].exists)
        shot(app, "me-about")
        app.terminate()
    }

    func testCoachPrivacyHandoff() {
        let app = launch(["-AuditConsentPrompt", "-ForceLightMode"])
        showTab("Coach", in: app)
        let suggestion = app.buttons["coach-suggestion"].firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 12))
        suggestion.tap()
        let notNow = app.buttons["ai-consent-not-now"]
        XCTAssertTrue(notNow.waitForExistence(timeout: 8))
        notNow.tap()
        let allow = app.buttons["coach-open-privacy"]
        XCTAssertTrue(allow.waitForExistence(timeout: 8))
        shot(app, "coach-blocked")
        allow.tap()
        let me = app.tabBars.buttons["Me"]
        XCTAssertTrue(me.waitForExistence(timeout: 8))
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline && !me.isSelected {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(me.isSelected, "Allow in Privacy did not open Me")
        if !settingsIsLive(app) {
            XCTFail("Settings was not on screen after Me was selected\n\(privacyAXDump(app))")
            return
        }

        let detail = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS 'The server keeps at most 20'")
        ).firstMatch
        let expanded = detail.waitForExistence(timeout: 4) || privacyMore(in: app).waitForExistence(timeout: 2)
        if !expanded {
            revealOnMeList(app) { detail.exists || privacyMore(in: app).exists }
        }
        var more = privacyMore(in: app)
        if !more.waitForExistence(timeout: 3) {
            revealOnMeList(app) { privacyMore(in: app).exists }
            more = privacyMore(in: app)
        }
        if !more.waitForExistence(timeout: 6) {
            XCTFail("me-privacy-more missing after Me was selected\n\(privacyAXDump(app))")
            return
        }
        if !detail.exists {
            revealOnMeList(app) { detail.exists }
        }
        if !detail.waitForExistence(timeout: 4) {
            XCTFail("Privacy detail missing after Me was selected\n\(privacyAXDump(app))")
            return
        }
        shot(app, "me-privacy")
        app.terminate()
    }

    func testScanOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-ForceLightMode"])
        showTab("Scan", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["scan-offline"].waitForExistence(timeout: 12))
        shot(app, "scan-offline")
        app.terminate()
    }

    func testScanFinishedOffline() {
        let app = launch(["-ReviewGuards", "-AuditOffline", "-AuditScanFinished", "-ForceLightMode"])
        showTab("Scan", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["scan-result-offline"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["Weekly haul score"].waitForExistence(timeout: 4))
        shot(app, "scan-result-offline")
        app.terminate()
    }

    func testOnboardingCards() {
        let app = launch(["-AuditOnboarding", "-ForceLightMode"])
        XCTAssertTrue(app.staticTexts["Welcome to FitMunch"].waitForExistence(timeout: 15))
        app.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Set Your Goals"].waitForExistence(timeout: 6))
        shot(app, "onboarding-goals")
        app.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Choose Your Plan"].waitForExistence(timeout: 6))
        shot(app, "onboarding-plan")
        app.terminate()
    }

    func testPaywallInlineRestore() {
        let app = launch(["-ReviewGuards", "-PaywallForceEmpty", "-ForceLightMode"])
        showTab("Me", in: app)
        let upgrade = app.buttons["settings-upgrade"]
        XCTAssertTrue(upgrade.waitForExistence(timeout: 12))
        upgrade.tap()
        let root = app.descendants(matching: .any)["paywall-root"]
        let errorState = app.descendants(matching: .any)["paywall-error-state"]
        let errorLine = app.descendants(matching: .any)["paywall-error"]
        let opened = root.waitForExistence(timeout: 20)
            || errorState.waitForExistence(timeout: 2)
            || errorLine.waitForExistence(timeout: 2)
        XCTAssertTrue(opened, "Paywall did not open")
        var restore = app.buttons["paywall-restore-inline"]
        if !restore.waitForExistence(timeout: 8) {
            restore = app.descendants(matching: .any)["paywall-restore-inline"]
        }
        XCTAssertTrue(restore.waitForExistence(timeout: 8), "paywall-restore-inline missing")
        var hops = 0
        while !restore.isHittable && hops < 5 {
            app.swipeUp()
            hops += 1
        }
        XCTAssertTrue(restore.isHittable)
        shot(app, "paywall-restore")
        app.terminate()
    }

    func testAuthErrorAX5() {
        let app = launch([
            "-AuditAuthError",
            "-ForceLightMode",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        let error = element("auth-error", in: app)
        XCTAssertTrue(error.waitForExistence(timeout: 12))
        let copy = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'invalid'")).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 4))
        shot(app, "auth-error-ax5")
        app.terminate()
    }

    /// Me is showing when a Settings marker is on screen, not merely loaded under Coach.
    private func settingsIsLive(_ app: XCUIApplication) -> Bool {
        let consent = app.descendants(matching: .any)["me-ai-consent"]
        if consent.waitForExistence(timeout: 4), consent.isHittable { return true }
        let features = app.staticTexts["AI features"]
        if features.waitForExistence(timeout: 2), features.isHittable { return true }
        let nav = app.navigationBars["Me"]
        if nav.waitForExistence(timeout: 2) {
            if nav.isHittable { return true }
            let title = nav.staticTexts["Me"].firstMatch
            if title.exists, title.isHittable { return true }
        }
        let version = app.staticTexts["Version"]
        if version.waitForExistence(timeout: 2), version.isHittable { return true }
        let dark = app.staticTexts["Dark Mode"]
        if dark.exists, dark.isHittable { return true }
        return false
    }

    /// Button query first, then any element with the identifier.
    private func privacyMore(in app: XCUIApplication) -> XCUIElement {
        let button = app.buttons["me-privacy-more"]
        if button.exists { return button }
        return app.descendants(matching: .any)["me-privacy-more"]
    }

    /// Hittable Settings list. Skips the Coach scroller, including a full-window one.
    private func meList(in app: XCUIApplication) -> XCUIElement? {
        let scrollers = (app.collectionViews.allElementsBoundByIndex + app.tables.allElementsBoundByIndex)
            .filter { $0.isHittable && $0.frame.height > 80 && $0.frame.width > 80 }
        func looksLikeCoach(_ row: XCUIElement) -> Bool {
            row.buttons["coach-suggestion"].exists
                || row.buttons["coach-open-privacy"].exists
                || row.descendants(matching: .any)["coach-open-privacy"].exists
                || row.staticTexts["Your AI training partner"].exists
        }
        func looksLikeMe(_ row: XCUIElement) -> Bool {
            row.staticTexts["Version"].exists
                || row.staticTexts["Dark Mode"].exists
                || row.staticTexts["AI features"].exists
                || row.staticTexts["Privacy"].exists
                || row.descendants(matching: .any)["me-ai-consent"].exists
                || row.descendants(matching: .any)["me-dark-mode"].exists
                || row.descendants(matching: .any)["me-privacy-more"].exists
        }
        let mine = scrollers.filter { looksLikeMe($0) && !looksLikeCoach($0) }
        if let tightest = mine.min(by: { $0.frame.height < $1.frame.height }) {
            return tightest
        }
        return scrollers.filter { !looksLikeCoach($0) }.min(by: { $0.frame.height < $1.frame.height })
    }

    private func revealOnMeList(_ app: XCUIApplication, _ seen: () -> Bool) {
        if seen() { return }
        for up in [true, true, true, true, true, true, false, false, false, false] {
            if seen() { return }
            nudgeMeList(app, up: up)
        }
    }

    private func nudgeMeList(_ app: XCUIApplication, up: Bool) {
        guard let list = meList(in: app) else {
            if up { app.swipeUp() } else { app.swipeDown() }
            return
        }
        let startY: CGFloat = up ? 0.72 : 0.38
        let endY: CGFloat = up ? 0.38 : 0.72
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.01, thenDragTo: end)
    }

    /// Failure-only snapshot. Not printed when the handoff passes.
    private func privacyAXDump(_ app: XCUIApplication) -> String {
        let pool = app.buttons.allElementsBoundByIndex
            + app.staticTexts.allElementsBoundByIndex
            + app.switches.allElementsBoundByIndex
            + app.navigationBars.allElementsBoundByIndex
        let lines = pool.compactMap { element -> String? in
            let label = element.label
            let identifier = element.identifier
            let interesting = identifier.contains("me-")
                || identifier.contains("coach-")
                || identifier.contains("privacy")
                || label.contains("Read more")
                || label.contains("Show less")
                || label.contains("AI features")
                || label.contains("Privacy")
                || label.contains("Version")
                || label.contains("Dark Mode")
                || label == "Me"
                || label == "Coach"
            guard interesting else { return nil }
            return "\(element.elementType.rawValue) id=\(identifier) label=\(label.prefix(90)) hittable=\(element.isHittable)"
        }
        let clipped = lines.prefix(40)
        return clipped.isEmpty ? "(no privacy or Me elements in buttons, text, switches, or nav bars)" : clipped.joined(separator: "\n")
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func showTab(_ name: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "Tab \(name) missing")
        button.tap()
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let device = (try? String(contentsOfFile: "/tmp/fitmunch-width-device", encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "device"
        let folder = URL(fileURLWithPath: "/tmp/fitmunch-width-capture/\(device)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("\(name).png")
        try? app.screenshot().pngRepresentation.write(to: url)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(device)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
