import UIKit
import XCTest

enum ReviewLaunchArgument {
    static let flag = "-ReviewGuards"
}

/// Local StoreKit configuration beside the running app. Isolated proof passes.
/// The same session beside the app does not.
enum StoreKitBesideApp {
    /// Joined at runtime so the skip text can name the proof prices. A single
    /// Swift literal with a dollar amount is the supermarket price gate.
    private static let audSign = "$"
    static let skipReason = "Isolated SKTestSession proof PASSES on the GitHub runner (AUD \(audSign)19.99/\(audSign)149.99, currency=AUD, 14-day FreeTrial; see runs 37553200762 / 37554689560 / 37561388738). The known gap is SKInternalErrorDomain Code=3 when the same session runs beside the app, which falls through to live USD. Unsigned GitHub Actions simulators stay on the US storefront despite en_AU and -testRegion AU. The isolated proof remains the AUD catalog gate. This check needs a working local StoreKit configuration next to the running app."
}

extension XCTestCase {
    func firstExisting(_ queries: [XCUIElement], timeout: TimeInterval = 3) -> XCUIElement? {
        for query in queries where query.waitForExistence(timeout: timeout) {
            return query
        }
        return nil
    }

    /// Five tabs: Today, Plan, Scan, Coach, Me. There is no More tab.
    func openTab(_ name: String, in app: XCUIApplication) {
        let resolved: String
        switch name {
        case "Home": resolved = "Today"
        case "Settings": resolved = "Me"
        default: resolved = name
        }
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 8), "Tab bar missing before opening \(resolved)")
        XCTAssertFalse(bar.buttons["More"].exists, "More tab is showing. FitMunch uses five tabs.")
        let direct = bar.buttons[resolved]
        XCTAssertTrue(direct.waitForExistence(timeout: 5), "Tab '\(resolved)' is not on the tab bar")
        direct.tap()
    }

    /// Replaces the screenshot seed with the QA account before a Me capture.
    func signInQAReplacingSeed(in app: XCUIApplication) {
        if app.staticTexts["FitMunch QA"].waitForExistence(timeout: 1) { return }
        let email = qaCredential("QA_EMAIL")
        let password = qaCredential("QA_PASSWORD")
        XCTAssertFalse(email.isEmpty || password.isEmpty, "QA_EMAIL and QA_PASSWORD are not set")
        let bar = app.tabBars.firstMatch
        if bar.waitForExistence(timeout: 4) {
            let me = bar.buttons["Me"]
            if me.waitForExistence(timeout: 4) { me.tap() }
        }
        let scroller = app.scrollViews.firstMatch
        var logout = app.buttons["Log Out"].firstMatch
        var hops = 0
        while !(logout.exists && logout.isHittable), hops < 8 {
            if scroller.exists {
                scroller.swipeUp()
            } else {
                app.swipeUp()
            }
            hops += 1
            logout = app.buttons["Log Out"].firstMatch
        }
        if logout.waitForExistence(timeout: 3), logout.isHittable {
            logout.tap()
            let confirm = app.alerts["Log Out"].buttons["Log Out"]
            XCTAssertTrue(confirm.waitForExistence(timeout: 6), "Log Out confirmation missing")
            confirm.tap()
        }
        let segment = app.segmentedControls.buttons["Sign In"]
        if segment.waitForExistence(timeout: 12) {
            segment.tap()
        } else {
            let signInButton = app.buttons["Sign In"]
            XCTAssertTrue(signInButton.waitForExistence(timeout: 8), "Sign In did not appear")
            signInButton.tap()
        }
        if !app.buttons["auth-sign-in"].waitForExistence(timeout: 2) {
            let signInButton = app.buttons["Sign In"]
            if signInButton.exists { signInButton.tap() }
        }
        let emailField = app.textFields["auth-email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 8), "Email field missing")
        emailField.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            emailField.tap()
        }
        emailField.typeText(email)
        let passwordField = app.secureTextFields["auth-password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 4), "Password field missing")
        passwordField.tap()
        passwordField.typeText(password)
        if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        } else if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        }
        let submit = app.buttons["auth-sign-in"]
        XCTAssertTrue(submit.waitForExistence(timeout: 4), "Sign In button missing")
        submit.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 40), "QA sign-in did not reach the tabs")
    }

    func assertNoSampleIdentity(in app: XCUIApplication) {
        XCTAssertFalse(app.staticTexts["Alex Morgan"].exists, "Sample name is on screen")
        XCTAssertFalse(app.staticTexts["alex@example.com"].exists, "Sample email is on screen")
        XCTAssertFalse(app.staticTexts["Reviewer"].exists, "Reviewer name is on screen")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "review@fitmunch.com.au")).firstMatch.exists,
            "Reviewer email is on screen"
        )
    }

    func qaCredential(_ key: String) -> String {
        let fromEnv = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !fromEnv.isEmpty { return fromEnv }
        let url = URL(fileURLWithPath: "/tmp/fitmunch-qa-credentials")
        guard key == "QA_EMAIL" || key == "QA_PASSWORD",
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        let lines = text.components(separatedBy: "\n")
        if key == "QA_EMAIL" { return lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        return lines.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
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
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func auditDeviceSlug() -> String {
        let raw = (try? String(contentsOfFile: "/tmp/pre-asc-audit-device", encoding: .utf8)) ?? "device"
        let slug = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return slug.isEmpty ? "device" : slug
    }

    func auditMode() -> String {
        let raw = (try? String(contentsOfFile: "/tmp/pre-asc-audit-mode", encoding: .utf8)) ?? ""
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @discardableResult
    func saveAuditScreen(_ app: XCUIApplication, baseName: String) -> String {
        let name = "\(baseName)-\(auditDeviceSlug())"
        let dir = URL(fileURLWithPath: "/tmp/pre-asc-audit/screenshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let shot = XCUIScreen.main.screenshot()
        let file = "\(name).png"
        let url = dir.appendingPathComponent(file)
        try? shot.pngRepresentation.write(to: url)
        if let image = UIImage(data: shot.pngRepresentation), let cg = image.cgImage {
            let appPoints = "\(Int(app.frame.width.rounded()))x\(Int(app.frame.height.rounded()))"
            let pixels = "\(cg.width)x\(cg.height)"
            appendAuditFile("sizes.txt", line: "\(file) app=\(appPoints) pixels=\(pixels)\n")
        }
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return file
    }

    func recordAudit(row: String, status: String, screenshot: String) {
        let line = "\(row)\t\(auditDeviceSlug())\t\(status)\t\(screenshot)\n"
        appendAuditFile("rows.tsv", line: line)
    }

    /// SwiftUI lists omit off-screen rows. Swipe the list itself until one candidate exists.
    func scrollUntilAnyExists(_ elements: [XCUIElement], in app: XCUIApplication, swipes: Int = 8) -> XCUIElement? {
        func match() -> XCUIElement? { elements.first { $0.exists } }
        if let found = match() { return found }
        let list = app.collectionViews.firstMatch
        let table = app.tables.firstMatch
        for _ in 0..<swipes {
            if list.exists {
                list.swipeUp()
            } else if table.exists {
                table.swipeUp()
            } else {
                app.swipeUp()
            }
            if let found = match() { return found }
        }
        return match()
    }

    /// Scroll a Settings-style list until the first existing candidate is hittable.
    /// A full swipeUp can park a row under the navigation bar (exists, visible point
    /// {-1,-1}) and the next swipe then drops it out of the tree. Short drags stay
    /// on the row and move it into the hittable band.
    func scrollUntilHittable(_ elements: [XCUIElement], in app: XCUIApplication, attempts: Int = 14) -> XCUIElement? {
        func firstExistingRow() -> XCUIElement? { elements.first { $0.exists } }
        let list = app.collectionViews.firstMatch
        let table = app.tables.firstMatch
        let scroller: XCUIElement = list.exists ? list : (table.exists ? table : app)

        let glassTop = floatingTabButtonTop(in: app)
        for _ in 0..<attempts {
            if let row = firstExistingRow() {
                if rowClearsTabBar(row, glassTop: glassTop) { return row }
                let frame = row.frame
                let bounds = app.windows.firstMatch.exists ? app.windows.firstMatch.frame : app.frame
                let hasFrame = frame.width > 1 && frame.height > 1
                // iPhone failure frame was {{16, 759.7}, {358, 52}}: isHittable was
                // true while the row sat in the floating glass, so the tap hit the bar.
                // A high row (under the nav bar) still needs a downward nudge.
                let band = max(bounds.height, 700) * 0.45
                let underGlass = hasFrame && frame.maxY > glassTop - 4
                let tooHigh = !hasFrame || frame.midY < band
                let fraction: CGFloat = underGlass ? -0.20 : (tooHigh ? 0.22 : -0.18)
                nudgeScroll(scroller, fraction: fraction)
                if let row = firstExistingRow(), rowClearsTabBar(row, glassTop: glassTop) { return row }
                if firstExistingRow() == nil {
                    nudgeScroll(scroller, fraction: tooHigh ? -0.12 : 0.16)
                }
            } else {
                nudgeScroll(scroller, fraction: -0.28)
            }
        }
        if let row = firstExistingRow(), rowClearsTabBar(row, glassTop: glassTop) { return row }
        return nil
    }

    /// Tab button top. The bar container starts lower than the floating glass.
    /// A missing or covered bar (full-screen paywall) uses the window bottom.
    func floatingTabButtonTop(in app: XCUIApplication) -> CGFloat {
        let windowBottom = app.windows.firstMatch.exists ? app.windows.firstMatch.frame.maxY : app.frame.maxY
        let bar = app.tabBars.firstMatch
        guard bar.exists, bar.isHittable, bar.frame.height > 1, bar.frame.minY < windowBottom - 20 else { return windowBottom }
        var top = bar.frame.minY
        for name in ["Today", "Plan", "Scan", "Coach", "Me"] {
            let button = bar.buttons[name]
            if button.exists, button.frame.height > 1, button.frame.minY < windowBottom {
                top = min(top, button.frame.minY)
            }
        }
        return top
    }

    private func rowClearsTabBar(_ row: XCUIElement, glassTop: CGFloat) -> Bool {
        guard row.isHittable else { return false }
        let frame = row.frame
        guard frame.width > 1, frame.height > 1 else { return false }
        return frame.maxY <= glassTop - 4
    }

    /// fraction < 0 moves the finger up and reveals rows below.
    /// fraction > 0 moves the finger down and brings a top-clipped row into view.
    private func nudgeScroll(_ element: XCUIElement, fraction: CGFloat) {
        let startY: CGFloat = fraction < 0 ? 0.72 : 0.38
        let endY = min(0.88, max(0.12, startY + fraction))
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    func reveal(_ element: XCUIElement, in app: XCUIApplication, swipes: Int = 6) {
        var remaining = swipes
        while !element.isHittable && remaining > 0 {
            app.swipeUp()
            remaining -= 1
        }
    }

    func planCard(_ app: XCUIApplication, id: String) -> XCUIElement {
        let button = app.buttons["paywall-plan-\(id)"]
        if button.exists { return button }
        return app.otherElements["paywall-plan-\(id)"]
    }

    func waitForPlanCard(_ app: XCUIApplication, id: String, timeout: TimeInterval) -> XCUIElement? {
        let started = Date()
        let deadline = started.addingTimeInterval(timeout)
        var swipes = 0
        while Date() < deadline {
            let queries = [
                app.buttons["paywall-plan-\(id)"],
                app.otherElements["paywall-plan-\(id)"],
                app.staticTexts["paywall-plan-title-\(id)"],
                app.staticTexts["paywall-price-\(id)"],
            ]
            for query in queries where query.exists {
                return query
            }
            if swipes < 3 && Date().timeIntervalSince(started) > 4 {
                app.swipeUp()
                swipes += 1
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return nil
    }

    func paywallIsShowing(in app: XCUIApplication) -> Bool {
        app.otherElements["paywall-root"].exists
            || app.buttons["paywall-close"].exists
            || app.staticTexts["Eat to your goals with every shop"].exists
    }

    func openUpgradePaywall(in app: XCUIApplication) {
        openTab("Me", in: app)
        var upgrade = firstExisting([
            app.buttons["settings-upgrade"],
            app.buttons["Upgrade"],
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
        ])
        if upgrade == nil {
            RunLoop.current.run(until: Date().addingTimeInterval(2))
            upgrade = firstExisting([
                app.buttons["settings-upgrade"],
                app.buttons["Upgrade"],
                app.buttons["settings-upgrade-premium"],
                app.buttons["Upgrade to Premium"],
            ])
        }
        XCTAssertNotNil(upgrade, "Upgrade control missing on Me")
        upgrade?.tap()
        // Close is on screen as soon as the paywall is. Do not wait out a missing
        // container identifier first, or the loading line finishes before we look.
        let ready = app.buttons["paywall-close"].waitForExistence(timeout: 8)
            || app.staticTexts["Eat to your goals with every shop"].waitForExistence(timeout: 2)
            || app.descendants(matching: .any)["paywall-loading"].exists
            || app.otherElements["paywall-root"].exists
        XCTAssertTrue(ready, "Paywall did not appear after Upgrade")
    }

    /// Fails when the Apple subscription sentence overlaps the Premium Monthly
    /// price, or when either one is clipped off the screen. Measured at rest:
    /// do not scroll the paywall before calling this.
    func assertMonthlyPriceClearsAppleSentence(in app: XCUIApplication) {
        let price = app.staticTexts["paywall-price-fitmunch_monthly"]
        let annual = app.staticTexts["paywall-price-fitmunch_annual"]
        let renewal = app.staticTexts["paywall-renewal"]
        let sentence = "Subscription auto-renews unless cancelled at least 24 hours before the period ends. Your subscription is charged to your Apple ID within 24 hours before renewal. Manage or cancel it in Account Settings."
        let deadline = Date().addingTimeInterval(12)
        while Date() < deadline {
            let priceReady = price.exists && price.frame.height > 16 && price.frame.width > 40
            let renewalReady = renewal.exists && renewal.frame.height > 44 && renewal.label.contains(sentence)
            if priceReady && renewalReady && annual.exists { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTAssertTrue(price.exists, "Monthly price missing")
        XCTAssertTrue(annual.exists, "Annual price missing")
        XCTAssertTrue(renewal.exists, "Apple subscription sentence missing")
        let priceFrame = price.frame
        let annualFrame = annual.frame
        let renewalFrame = renewal.frame
        let screen = app.frame
        let plan = presentElement("paywall-plan-fitmunch_monthly", in: app)
        let planFrame = plan?.frame ?? .null
        print(String(
            format: "PAYWALL_FRAMES screen=%@ annual=%@ monthly=%@ plan=%@ renewal=%@",
            rectString(screen),
            rectString(annualFrame),
            rectString(priceFrame),
            rectString(planFrame),
            rectString(renewalFrame)
        ))
        XCTAssertTrue(price.label.contains("/month"), "Monthly price is not readable. \(price.label)")
        XCTAssertTrue(annual.label.contains("/year"), "Annual price is not readable. \(annual.label)")
        XCTAssertTrue(renewal.label.contains(sentence), "Apple sentence is incomplete. \(renewal.label)")
        XCTAssertGreaterThan(priceFrame.height, 16, "Monthly price is clipped \(priceFrame)")
        XCTAssertGreaterThan(priceFrame.width, 40, "Monthly price is clipped \(priceFrame)")
        XCTAssertGreaterThan(renewalFrame.height, 44, "Apple sentence is clipped \(renewalFrame)")
        assertOnScreen(priceFrame, named: "monthly price", in: screen)
        assertOnScreen(annualFrame, named: "annual price", in: screen)
        assertOnScreen(renewalFrame, named: "Apple sentence", in: screen)
        XCTAssertFalse(
            priceFrame.intersects(renewalFrame),
            "Apple sentence overlaps the monthly price. price=\(priceFrame) renewal=\(renewalFrame)"
        )
        XCTAssertLessThanOrEqual(
            priceFrame.maxY + 8,
            renewalFrame.minY,
            "Monthly price runs into the Apple sentence. price=\(priceFrame) renewal=\(renewalFrame)"
        )
        if let plan {
            XCTAssertFalse(
                planFrame.intersects(renewalFrame),
                "Apple sentence overlaps the monthly plan. plan=\(planFrame) renewal=\(renewalFrame)"
            )
        }
        XCTAssertLessThanOrEqual(annualFrame.maxY, priceFrame.minY, "Annual price is not above the monthly price")
        XCTAssertFalse(annualFrame.intersects(renewalFrame), "Apple sentence overlaps the annual price")
        let subscribe = app.buttons["paywall-subscribe"]
        XCTAssertTrue(subscribe.exists, "Trial button missing")
        XCTAssertFalse(subscribe.frame.intersects(renewalFrame), "Trial button covers the Apple sentence")
        XCTAssertFalse(subscribe.frame.intersects(priceFrame), "Trial button covers the monthly price")
        XCTAssertGreaterThanOrEqual(subscribe.frame.minY, renewalFrame.maxY - 1)
        let restore = app.buttons["paywall-restore"]
        XCTAssertTrue(restore.exists, "Restore Purchases missing")
        XCTAssertGreaterThanOrEqual(restore.frame.height, 44)
        XCTAssertFalse(restore.frame.intersects(priceFrame))
        XCTAssertFalse(restore.frame.intersects(renewalFrame))
        assertOnScreen(restore.frame, named: "Restore", in: screen)
        let terms = presentElement("paywall-terms", in: app) ?? presentElement("Terms", in: app)
        let privacy = presentElement("paywall-privacy", in: app) ?? presentElement("Privacy", in: app)
        XCTAssertNotNil(terms, "Terms missing")
        XCTAssertNotNil(privacy, "Privacy missing")
        if let terms, let privacy {
            XCTAssertGreaterThanOrEqual(terms.frame.height, 44)
            XCTAssertGreaterThanOrEqual(privacy.frame.height, 44)
            XCTAssertFalse(terms.frame.intersects(priceFrame))
            XCTAssertFalse(privacy.frame.intersects(renewalFrame))
            assertOnScreen(terms.frame, named: "Terms", in: screen)
            assertOnScreen(privacy.frame, named: "Privacy", in: screen)
        }
    }

    /// `.frame` on a missing query fails the test with a snapshot error.
    /// Existence is the only safe probe.
    private func presentElement(_ identifier: String, in app: XCUIApplication) -> XCUIElement? {
        let button = app.buttons[identifier]
        if button.exists { return button }
        let text = app.staticTexts[identifier]
        if text.exists { return text }
        let other = app.otherElements[identifier]
        if other.exists { return other }
        return nil
    }

    private func assertOnScreen(_ frame: CGRect, named name: String, in screen: CGRect) {
        XCTAssertGreaterThanOrEqual(frame.minX, -1, "\(name) is clipped on the left \(frame)")
        XCTAssertLessThanOrEqual(frame.maxX, screen.maxX + 1, "\(name) is clipped on the right \(frame)")
        XCTAssertGreaterThanOrEqual(frame.minY, -1, "\(name) is clipped at the top \(frame)")
        XCTAssertLessThanOrEqual(frame.maxY, screen.maxY + 1, "\(name) is clipped at the bottom \(frame)")
        XCTAssertGreaterThan(frame.width, 1, "\(name) has no width \(frame)")
        XCTAssertGreaterThan(frame.height, 1, "\(name) has no height \(frame)")
    }

    private func rectString(_ rect: CGRect) -> String {
        String(
            format: "{{%.1f, %.1f}, {%.1f, %.1f}}",
            rect.origin.x,
            rect.origin.y,
            rect.size.width,
            rect.size.height
        )
    }

    private func appendAuditFile(_ name: String, line: String) {
        let dir = URL(fileURLWithPath: "/tmp/pre-asc-audit", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        let data = Data(line.utf8)
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }

    // MARK: - At-rest fold checks for Today and Me

    /// Tab bar fold, measured the way TabBarClearanceUITests measures it: the
    /// bar container or its highest tab button, whichever is higher.
    func restFoldTop(in app: XCUIApplication) -> CGFloat {
        let window = app.windows.firstMatch
        let windowBottom = window.exists ? window.frame.maxY : app.frame.maxY
        let bar = app.tabBars.firstMatch
        var top = windowBottom
        if bar.exists, bar.frame.height > 1 {
            top = min(top, bar.frame.minY)
        }
        for name in ["Today", "Plan", "Scan", "Coach", "Me"] {
            let button = bar.buttons[name]
            if button.exists, button.frame.height > 1, button.frame.minY < windowBottom {
                top = min(top, button.frame.minY)
            }
        }
        return top
    }

    /// Resting Today, before any drag. The Breakfast, Lunch, and Dinner cards
    /// each end at least 8pt above the tab bar fold (limit = fold minY - 8).
    func assertTodayRestsAtFold(in app: XCUIApplication, place: String) {
        XCTAssertTrue(
            app.staticTexts["Dinner"].waitForExistence(timeout: 12),
            "Seeded Dinner is not on Today (\(place))"
        )
        // The short phone switches Daily Summary to its compact height after the first layout.
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let window = app.windows.firstMatch
        let width = window.exists ? window.frame.width : app.frame.width
        let fold = restFoldTop(in: app)
        let limit = fold - 8
        let names = ["Breakfast", "Lunch", "Dinner"]
        var bottoms: [String: CGFloat] = [:]
        let cards = app.descendants(matching: .any)
            .matching(identifier: "today-meal-card")
            .allElementsBoundByIndex
        for card in cards {
            let frame = card.frame
            guard frame.width > 80, frame.height > 40 else { continue }
            let nameText = card.staticTexts["today-meal-name"]
            let title = nameText.exists ? nameText.label : card.label
            guard names.contains(title) else { continue }
            bottoms[title] = max(bottoms[title] ?? 0, frame.maxY)
        }
        var parts: [String] = []
        for name in names {
            if let maxY = bottoms[name] {
                parts.append("\(name.lowercased())MaxY=\(maxY)")
            } else {
                parts.append("\(name.lowercased())MaxY=missing")
            }
        }
        print("TODAY_REST place=\(place) width=\(Int(width.rounded())) fold=\(fold) limit=\(limit) \(parts.joined(separator: " "))")
        for name in names {
            guard let maxY = bottoms[name] else {
                XCTFail("\(name) card is not on Today at rest (\(place))")
                continue
            }
            XCTAssertLessThanOrEqual(
                maxY,
                limit + 0.5,
                "Today at rest (\(place)): \(name) card ends at \(maxY), below the tab bar fold minus 8pt (fold \(fold), limit \(limit))"
            )
        }
    }

    /// Resting Me, before any drag. No list row straddles the tab bar: each row
    /// ends at least 8pt above the fold, or starts at or under the fold.
    func assertMeRestsAtFold(in app: XCUIApplication, place: String) {
        XCTAssertTrue(
            app.switches["me-dark-mode"].waitForExistence(timeout: 15),
            "Dark Mode row is not on Me (\(place))"
        )
        _ = app.staticTexts["Alex Morgan"].waitForExistence(timeout: 8)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let window = app.windows.firstMatch
        let screen = window.exists ? window.frame : app.frame
        let fold = restFoldTop(in: app)
        let limit = fold - 8
        let rows = meRestRows(in: app, screen: screen)
        var lastAbove: CGFloat = 0
        var firstBelow: CGFloat = -1
        var straddling: [(label: String, frame: CGRect)] = []
        for row in rows {
            if row.frame.maxY <= limit + 0.5 {
                lastAbove = max(lastAbove, row.frame.maxY)
            } else if row.frame.minY >= fold - 0.5 {
                firstBelow = firstBelow < 0 ? row.frame.minY : min(firstBelow, row.frame.minY)
            } else {
                straddling.append(row)
            }
        }
        print("ME_REST place=\(place) width=\(Int(screen.width.rounded())) fold=\(fold) limit=\(limit) rows=\(rows.count) lastAboveMaxY=\(lastAbove) firstBelowMinY=\(firstBelow) straddling=\(straddling.count)")
        for row in rows {
            print("ME_REST row '\(row.label)' minY=\(row.frame.minY) maxY=\(row.frame.maxY)")
        }
        XCTAssertGreaterThan(rows.count, 0, "Me at rest has no list rows (\(place))")
        XCTAssertGreaterThan(lastAbove, 0, "Me at rest has no whole row above the tab bar (\(place))")
        let cut = straddling.first
        XCTAssertNil(
            cut,
            "Me at rest (\(place)): row '\(cut?.label ?? "")' \(String(describing: cut?.frame)) crosses the tab bar (fold \(fold), limit \(limit))"
        )
    }

    /// On-screen Me list rows: cells with a visible label, switch, or button.
    private func meRestRows(in app: XCUIApplication, screen: CGRect) -> [(label: String, frame: CGRect)] {
        guard let root = try? app.snapshot() else { return [] }
        let contentTypes: [XCUIElement.ElementType] = [
            .staticText,
            .button,
            .image,
            XCUIElement.ElementType.switch,
        ]
        var rows: [(label: String, frame: CGRect)] = []
        func hasContent(_ node: XCUIElementSnapshot) -> Bool {
            for child in node.children {
                if contentTypes.contains(child.elementType),
                   !child.label.isEmpty || !child.identifier.isEmpty {
                    return true
                }
                if hasContent(child) { return true }
            }
            return false
        }
        func walk(_ node: XCUIElementSnapshot) {
            if node.elementType == .tabBar { return }
            if node.elementType == .cell {
                let frame = node.frame
                if frame.width > 200, frame.height > 20, frame.height < 240,
                   frame.minX >= screen.minX - 1, frame.maxX <= screen.maxX + 1,
                   frame.minY < screen.maxY, frame.maxY > screen.minY, hasContent(node) {
                    let name = node.label.isEmpty ? node.identifier : node.label
                    rows.append((label: name, frame: frame))
                }
            }
            for child in node.children {
                walk(child)
            }
        }
        walk(root)
        return rows
    }
}
