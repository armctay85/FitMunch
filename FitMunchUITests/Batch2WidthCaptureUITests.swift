import StoreKitTest
import XCTest

/// Changed build 11 screens at 375pt and 440pt widths.
final class Batch2WidthCaptureUITests: XCTestCase {
    /// Lives in this UI test process, which is an XCTest host. The app target does not open a session.
    private var storeKit: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        storeKit = nil
        let url = try XCTUnwrap(
            Bundle(for: Batch2WidthCaptureUITests.self)
                .url(forResource: "FitMunchProducts", withExtension: "storekit"),
            "FitMunchProducts.storekit is not in the UI test bundle"
        )
        let created = try SKTestSession(contentsOf: url)
        created.disableDialogs = true
        created.resetToDefaultState()
        created.clearTransactions()
        created.storefront = "AUS"
        created.locale = Locale(identifier: "en_AU")
        storeKit = created
        print("WIDTH_STOREKIT file=\(url.path) storefront=\(created.storefront) locale=\(created.locale.identifier)")
        assertAustraliaStorefrontBeforeLaunch()
    }

    override func tearDownWithError() throws {
        storeKit = nil
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
        tapOnboardingNext(in: app)
        XCTAssertTrue(app.staticTexts["Set Your Goals"].waitForExistence(timeout: 6))
        let goals = [
            "onboarding-goal-weight_loss",
            "onboarding-goal-muscle_gain",
            "onboarding-goal-maintenance",
            "onboarding-goal-endurance",
        ]
        let goalRows = goals.map { app.descendants(matching: .any)[$0] }
        revealFullyAboveFooter(goalRows, in: app)
        let goalFooter = app.buttons["Next"]
        for id in goals {
            let row = app.descendants(matching: .any)[id]
            XCTAssertTrue(row.waitForExistence(timeout: 4), "Goal \(id) missing")
            XCTAssertTrue(row.isHittable, "Goal \(id) is not readable")
            XCTAssertGreaterThan(row.frame.height, 36, "Goal \(id) is clipped")
            XCTAssertLessThanOrEqual(
                row.frame.maxY,
                goalFooter.frame.minY + 0.5,
                "Goal \(id) is under Back/Next"
            )
        }
        shot(app, "onboarding-goals")
        tapOnboardingNext(in: app)
        XCTAssertTrue(app.staticTexts["Choose Your Plan"].waitForExistence(timeout: 6))
        let label = waitForMonthlyPrice(in: app)
        print("ONBOARDING_PRICE \(label)")
        XCTAssertTrue(
            label.contains("19.99") && !label.contains("12.99"),
            "Onboarding plan must show StoreKit monthly displayPrice (19.99, not 12.99). Saw \(label.isEmpty ? visibleMoney(in: app) : label)"
        )
        XCTAssertFalse(visibleMoney(in: app).contains("12.99"), "US storefront price is on the plan screen")
        let free = app.descendants(matching: .any)["onboarding-plan-free"]
        let premium = app.descendants(matching: .any)["onboarding-plan-premium"]
        revealPlanCards(free: free, premium: premium, in: app)
        let planFooter = app.buttons["onboarding-get-started"]
        XCTAssertTrue(free.waitForExistence(timeout: 4), "Free card missing")
        XCTAssertTrue(premium.waitForExistence(timeout: 4), "Premium card missing")
        XCTAssertTrue(free.isHittable, "Free card is not readable")
        XCTAssertLessThanOrEqual(free.frame.maxY, planFooter.frame.minY + 0.5, "Free card is under the footer")
        XCTAssertTrue(premium.isHittable, "Premium card is not reachable")
        XCTAssertLessThan(premium.frame.minY, planFooter.frame.minY - 4, "Premium card is covered by the footer")
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

    /// Next sits outside the scroll view, so a tap has to land on this button.
    private func tapOnboardingNext(in app: XCUIApplication) {
        let next = app.buttons["onboarding-next"]
        XCTAssertTrue(next.waitForExistence(timeout: 4), "Next missing")
        XCTAssertTrue(next.isEnabled, "Next is disabled")
        XCTAssertTrue(next.isHittable, "Next is not hittable")
        next.tap()
    }

    private func onboardingFooterMinY(in app: XCUIApplication) -> CGFloat {
        let next = app.buttons["onboarding-next"]
        if next.exists { return next.frame.minY }
        let start = app.buttons["onboarding-get-started"]
        if start.exists { return start.frame.minY }
        return app.frame.maxY - 72
    }

    private func nudgeOnboarding(_ app: XCUIApplication, up: Bool) {
        let scrollers = app.scrollViews.allElementsBoundByIndex.filter { $0.isHittable && $0.frame.height > 80 }
        guard let list = scrollers.max(by: { $0.frame.height < $1.frame.height }) else {
            if up { app.swipeUp() } else { app.swipeDown() }
            return
        }
        let startY: CGFloat = up ? 0.62 : 0.42
        let endY: CGFloat = up ? 0.42 : 0.62
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.01, thenDragTo: end)
    }

    /// Small drags until every row sits fully above Back/Next.
    private func revealFullyAboveFooter(_ rows: [XCUIElement], in app: XCUIApplication) {
        func placed() -> Bool {
            let limit = onboardingFooterMinY(in: app) - 1
            return rows.allSatisfy { row in
                row.exists && row.isHittable && row.frame.minY >= 4 && row.frame.maxY <= limit && row.frame.height > 36
            }
        }
        if placed() { return }
        for up in [true, true, true, true, true, true, false, false, false] {
            if placed() { return }
            nudgeOnboarding(app, up: up)
        }
    }

    /// Top of the footer material, not the button inside it.
    private func onboardingFooterTop(in app: XCUIApplication) -> CGFloat {
        let footer = app.descendants(matching: .any)["onboarding-footer"]
        if footer.exists, footer.frame.height > 1 {
            return footer.frame.minY
        }
        // Button sits 12pt below the material. The offer has to clear the material.
        return onboardingFooterMinY(in: app) - 12
    }

    /// The price text and the trial sentence. Prefer the glyph frame when the
    /// identifier's frame is the whole card.
    private func offerLine(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let marked = app.descendants(matching: .any)[identifier]
        guard marked.exists else { return marked }
        let text = app.staticTexts[marked.label].firstMatch
        if text.exists, text.frame.height > 8, text.frame.height + 8 < marked.frame.height {
            return text
        }
        return marked
    }

    /// Free must clear the footer. Premium must start on screen, and the
    /// StoreKit price plus the trial line must both sit above the footer.
    private func revealPlanCards(free: XCUIElement, premium: XCUIElement, in app: XCUIApplication) {
        func priceLine() -> XCUIElement { offerLine("onboarding-premium-price", in: app) }
        func trialLine() -> XCUIElement { offerLine("onboarding-premium-trial", in: app) }
        func offerClearsFooter() -> Bool {
            let limit = onboardingFooterTop(in: app)
            let price = priceLine()
            let trial = trialLine()
            guard price.exists, trial.exists else { return false }
            guard price.frame.height > 8, trial.frame.height > 8 else { return false }
            return price.frame.maxY <= limit && trial.frame.maxY <= limit
        }
        func placed() -> Bool {
            guard free.exists, premium.exists else { return false }
            let limit = onboardingFooterMinY(in: app) - 1
            let freeClear = free.isHittable && free.frame.minY >= 0 && free.frame.maxY <= limit
            let premiumIn = premium.isHittable && premium.frame.minY >= 0 && premium.frame.minY < limit - 4
            return freeClear && premiumIn && offerClearsFooter()
        }
        _ = app.descendants(matching: .any)["onboarding-premium-price"].waitForExistence(timeout: 6)
        _ = app.descendants(matching: .any)["onboarding-premium-trial"].waitForExistence(timeout: 6)
        if !placed() {
            for up in [true, true, true, true, true, true, true, false, false] {
                if placed() { break }
                nudgeOnboarding(app, up: up)
            }
        }
        let price = priceLine()
        let trial = trialLine()
        let limit = onboardingFooterTop(in: app)
        print(String(
            format: "ONBOARDING_OFFER priceBottom=%.1f trialBottom=%.1f footerTop=%.1f",
            price.frame.maxY,
            trial.frame.maxY,
            limit
        ))
        XCTAssertTrue(price.exists, "Premium price missing")
        XCTAssertTrue(trial.exists, "Trial line missing")
        XCTAssertGreaterThan(price.frame.height, 8, "Price has no height")
        XCTAssertGreaterThan(trial.frame.height, 8, "Trial line has no height")
        XCTAssertLessThanOrEqual(
            price.frame.maxY,
            limit,
            "Price is clipped by the footer (price \(price.frame) footer top \(limit))"
        )
        XCTAssertLessThanOrEqual(
            trial.frame.maxY,
            limit,
            "Trial line is clipped by the footer (trial \(trial.frame) footer top \(limit))"
        )
        if price.exists, trial.exists, !price.label.isEmpty, price.label.count <= 32 {
            XCTAssertTrue(
                trial.label.contains(price.label),
                "Trial line must repeat the StoreKit displayPrice"
            )
        }
    }

    /// StoreKit displayPrice from the premium card. Polls so "See plans" can update.
    private func waitForMonthlyPrice(in app: XCUIApplication) -> String {
        let deadline = Date().addingTimeInterval(25)
        var latest = ""
        while Date() < deadline {
            latest = currentMonthlyPrice(in: app)
            if latest.contains("19.99"), !latest.contains("12.99") {
                return latest
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        return latest
    }

    private func currentMonthlyPrice(in app: XCUIApplication) -> String {
        let tagged = app.descendants(matching: .any)["onboarding-premium-price"]
        if tagged.exists, !tagged.label.isEmpty { return tagged.label }
        let card = app.descendants(matching: .any)["onboarding-plan-premium"]
        if card.exists, !card.label.isEmpty { return card.label }
        return visibleMoney(in: app)
    }

    private func visibleMoney(in app: XCUIApplication) -> String {
        let hits = app.staticTexts.allElementsBoundByIndex.map(\.label).filter { label in
            label.contains("19.99") || label.contains("12.99") || label.contains("99.99")
                || label.contains("149.99") || label.contains("See plans")
        }
        return hits.joined(separator: " | ")
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
        assertAustraliaStorefrontBeforeLaunch()
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func assertAustraliaStorefrontBeforeLaunch() {
        let storefront = storeKit?.storefront ?? ""
        let locale = storeKit?.locale.identifier ?? ""
        XCTAssertEqual(
            storefront,
            "AUS",
            "StoreKit test session must read back storefront AUS before launch. Read storefront=\(storefront) locale=\(locale)"
        )
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
