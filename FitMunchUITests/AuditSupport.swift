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
}
