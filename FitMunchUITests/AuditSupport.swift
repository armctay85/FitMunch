import UIKit
import XCTest

enum ReviewLaunchArgument {
    static let flag = "-ReviewGuards"
}

extension XCTestCase {
    func firstExisting(_ queries: [XCUIElement], timeout: TimeInterval = 3) -> XCUIElement? {
        for query in queries where query.waitForExistence(timeout: timeout) {
            return query
        }
        return nil
    }

    func openTab(_ name: String, in app: XCUIApplication) {
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 8), "Tab bar missing before opening \(name)")
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

        for _ in 0..<attempts {
            if let row = firstExistingRow() {
                if row.isHittable { return row }
                let frame = row.frame
                let bounds = app.windows.firstMatch.exists ? app.windows.firstMatch.frame : app.frame
                let hasFrame = frame.width > 1 && frame.height > 1
                // iPhone failure frame was {{19.5, 246.9}, {351, 63.4}} with visible
                // point {-1,-1}. The same row was hittable at y=556. Nudge a
                // high row down. A 320x480 app.frame must not shrink this band.
                let band = max(bounds.height, 700) * 0.45
                let tooHigh = !hasFrame || frame.midY < band
                nudgeScroll(scroller, fraction: tooHigh ? 0.22 : -0.18)
                if let row = firstExistingRow(), row.isHittable { return row }
                if firstExistingRow() == nil {
                    nudgeScroll(scroller, fraction: tooHigh ? -0.12 : 0.16)
                }
            } else {
                nudgeScroll(scroller, fraction: -0.28)
            }
        }
        if let row = firstExistingRow(), row.isHittable { return row }
        return nil
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
            || app.staticTexts["Unlock Premium Features"].exists
    }

    func openUpgradePaywall(in app: XCUIApplication) {
        openTab("Settings", in: app)
        let upgrade = firstExisting([
            app.buttons["settings-upgrade"],
            app.buttons["Upgrade"],
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
        ])
        XCTAssertNotNil(upgrade, "Upgrade control missing on Settings")
        upgrade?.tap()
        // Close is on screen as soon as the paywall is. Do not wait out a missing
        // container identifier first, or the loading line finishes before we look.
        let ready = app.buttons["paywall-close"].waitForExistence(timeout: 8)
            || app.staticTexts["Unlock Premium Features"].waitForExistence(timeout: 2)
            || app.staticTexts["paywall-load-phase"].exists
            || app.staticTexts["Loading plans"].exists
            || app.otherElements["paywall-root"].exists
        XCTAssertTrue(ready, "Paywall did not appear after Upgrade")
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
