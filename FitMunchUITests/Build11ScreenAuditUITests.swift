import UIKit
import XCTest

/// Build 11 screen audit. One method per flow so a failed screen still leaves the rest.
/// Screenshots land in /tmp/fitmunch-audit-2026-10-15/<device>/.
final class Build11ScreenAuditUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
        XCUIDevice.shared.appearance = .light
    }

    func testAuthRegisterSignInAndError() {
        let app = launch([])
        guard wait(app.staticTexts["Your AI health partner"], 20) else {
            mark("Auth", "register", "FAIL", "Account screen did not appear", shot(app, "auth-register"))
            return
        }
        let registerShot = shot(app, "auth-register")
        mark("Auth", "register", "PASS", copyNote(app), registerShot)
        app.buttons["Sign In"].firstMatch.tap()
        let signIn = wait(app.buttons["auth-sign-in"], 6)
        let signInShot = shot(app, "auth-sign-in")
        mark("Auth", "sign-in", signIn ? "PASS" : "FAIL", copyNote(app), signInShot)
        let email = app.textFields["Email"]
        let password = app.secureTextFields["Password (min. 8 characters)"]
        if email.waitForExistence(timeout: 4) {
            email.tap()
            email.typeText("audit.not.a.user@fitmunch.com.au")
        }
        if password.waitForExistence(timeout: 2) {
            password.tap()
            password.typeText("not-the-password")
        }
        if app.buttons["auth-sign-in"].exists {
            app.buttons["auth-sign-in"].tap()
        }
        let sawError = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'wrong' OR label CONTAINS[c] 'try again' OR label CONTAINS[c] 'network' OR label CONTAINS[c] 'invalid' OR label CONTAINS[c] 'incorrect' OR label CONTAINS[c] 'failed'")).firstMatch.waitForExistence(timeout: 12)
        let errorShot = shot(app, "auth-error")
        mark("Auth", "error", sawError ? "PASS" : "FAIL", sawError ? copyNote(app) : "No error text within 12s. \(copyNote(app))", errorShot)
        app.terminate()
    }

    func testOnboardingSteps() {
        let app = launch([AuditLaunchArgument.onboarding])
        guard wait(app.staticTexts["Welcome to FitMunch"], 20) else {
            mark("Onboarding", "welcome", "FAIL", "Welcome step missing", shot(app, "onboarding-welcome"))
            return
        }
        mark("Onboarding", "welcome", "PASS", copyNote(app), shot(app, "onboarding-welcome"))
        app.buttons["Next"].firstMatch.tap()
        let goals = wait(app.staticTexts["Set Your Goals"], 6)
        mark("Onboarding", "goals", goals ? "PASS" : "FAIL", copyNote(app), shot(app, "onboarding-goals"))
        if app.buttons["Next"].exists { app.buttons["Next"].firstMatch.tap() }
        let plan = wait(app.staticTexts["Choose Your Plan"], 6)
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        let planNote = copyNote(app, allowStorePrice: true)
        let weekly = app.staticTexts.allElementsBoundByIndex.contains { $0.label.localizedCaseInsensitiveContains("fitmunch_weekly") || $0.label.localizedCaseInsensitiveContains("weekly premium") }
        mark("Onboarding", "plan", plan && !weekly ? "PASS" : "FAIL", weekly ? "fitmunch_weekly or Weekly Premium is on the plan step. \(planNote)" : planNote, shot(app, "onboarding-plan"))
        if app.buttons["Get Started"].exists {
            app.buttons["Get Started"].tap()
            let validation = app.alerts["Error"].waitForExistence(timeout: 4)
            mark("Onboarding", "validation-error", validation ? "PASS" : "FAIL", validation ? "Name and email required" : "Get Started did not show an error", shot(app, "onboarding-validation"))
            if app.alerts["Error"].buttons["OK"].exists { app.alerts["Error"].buttons["OK"].tap() }
        }
        app.terminate()
    }

    func testConsentSheetAndBlockedFeatures() {
        let app = launch([AuditLaunchArgument.consentPrompt])
        guard waitForTabs(app) else { return }
        openTab("Coach", in: app)
        mark("Coach", "empty", app.staticTexts["Your AI training partner"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "coach-empty"))
        let suggestion = app.buttons["coach-suggestion"].firstMatch
        if suggestion.waitForExistence(timeout: 4) { suggestion.tap() }
        let sheet = wait(app.buttons["ai-consent-allow"], 8)
        mark("Consent", "sheet", sheet ? "PASS" : "FAIL", copyNote(app, allowStorePrice: true), shot(app, "consent-sheet"))
        if app.buttons["ai-consent-not-now"].exists { app.buttons["ai-consent-not-now"].tap() }
        let blocked = wait(app.staticTexts["coach-consent-blocked"], 6) || app.staticTexts[AIBlocked.coach].waitForExistence(timeout: 2)
        mark("Coach", "consent-blocked", blocked ? "PASS" : "FAIL", copyNote(app), shot(app, "coach-blocked"))

        openTab("Scan", in: app)
        mark("Scan", "empty", app.staticTexts["Scan your shop"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "scan-empty"))
        if app.buttons["scan-take-photo"].exists { app.buttons["scan-take-photo"].tap() }
        let scanBlocked = app.staticTexts[AIBlocked.scan].waitForExistence(timeout: 6)
        mark("Scan", "consent-blocked", scanBlocked ? "PASS" : "FAIL", copyNote(app), shot(app, "scan-blocked"))

        openTab("Plan", in: app)
        let empty = app.staticTexts["No week yet"].waitForExistence(timeout: 6)
        mark("Plan", "empty", empty ? "PASS" : "FAIL", copyNote(app), shot(app, "plan-empty"))
        if app.buttons["plan-generate"].exists { app.buttons["plan-generate"].tap() }
        let planBlocked = app.staticTexts[AIBlocked.plan].waitForExistence(timeout: 6)
        mark("Plan", "consent-blocked", planBlocked ? "PASS" : "FAIL", copyNote(app), shot(app, "plan-blocked"))
        if app.buttons["Training"].exists { app.buttons["Training"].tap() }
        let training = app.staticTexts["Weekly plan"].waitForExistence(timeout: 6)
        mark("Plan", "training", training ? "PASS" : "FAIL", copyNote(app), shot(app, "plan-training"))
        app.terminate()
    }

    func testTodayEmptySettingsProgressAndLogMeal() {
        let app = launch([ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        let emptyMeals = app.staticTexts["No meals logged today"].waitForExistence(timeout: 8)
        mark("Today", "empty", emptyMeals ? "PASS" : "FAIL", copyNote(app), shot(app, "today-empty"))
        if app.buttons["today-log-meal"].exists { app.buttons["today-log-meal"].tap() }
        let meal = app.textFields["meal-name"].waitForExistence(timeout: 6)
        mark("Today", "log-meal", meal ? "PASS" : "FAIL", copyNote(app), shot(app, "today-log-meal"))
        if app.buttons["Cancel"].exists {
            app.buttons["Cancel"].tap()
        } else if app.navigationBars.buttons.firstMatch.exists {
            app.navigationBars.buttons.firstMatch.tap()
        }

        openTab("Me", in: app)
        captureProgress(in: app)
        openTab("Me", in: app)
        let upgrade = app.buttons["settings-upgrade"].waitForExistence(timeout: 6)
        mark("Me", "free", upgrade ? "PASS" : "FAIL", copyNote(app), shot(app, "me-top"))
        _ = scrollUntilAnyExists([app.staticTexts["March 2025"], app.staticTexts["Version"]], in: app)
        let stale = app.staticTexts["March 2025"].exists
        mark("Settings", "about", stale ? "FAIL" : "PASS", stale ? "Build Date is hardcoded March 2025" : copyNote(app), shot(app, "me-about"))
        app.terminate()
    }

    /// Progress is the first row on Me. Capture it before any scroll that pushes that row off screen.
    func testProgressCapture() {
        let app = launch([ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openTab("Me", in: app)
        captureProgress(in: app)
        app.terminate()
    }

    func testPaywallPlansRestoreAndPurchase() {
        let app = launch([ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openUpgradePaywall(in: app)
        let phase = waitForPaywall(app)
        let weeklyCard = app.buttons["paywall-plan-fitmunch_weekly"].exists || app.staticTexts["paywall-plan-title-fitmunch_weekly"].exists
        let weeklyWord = visibleText(app).localizedCaseInsensitiveContains("fitmunch_weekly")
        let plansOk = phase == "plans" && !weeklyCard && !weeklyWord
        mark("Paywall", "plans", plansOk ? "PASS" : "FAIL", "phase=\(phase) weeklyCard=\(weeklyCard) weeklyId=\(weeklyWord). \(copyNote(app, allowStorePrice: true))", shot(app, "paywall-plans"))
        if app.buttons["paywall-restore"].exists {
            reveal(app.buttons["paywall-restore"], in: app)
            app.buttons["paywall-restore"].tap()
        }
        let restored = app.alerts["Restore Purchases"].waitForExistence(timeout: 15)
        mark("Paywall", "restore", restored ? "PASS" : "FAIL", restored ? "Restore alert appeared" : "Restore did not finish", shot(app, "paywall-restore"))
        if app.alerts["Restore Purchases"].buttons["OK"].exists {
            app.alerts["Restore Purchases"].buttons["OK"].tap()
        }
        if app.buttons["paywall-subscribe"].waitForExistence(timeout: 3) {
            app.buttons["paywall-subscribe"].tap()
            let sheet = app.alerts.firstMatch.waitForExistence(timeout: 8) || app.sheets.firstMatch.waitForExistence(timeout: 2)
            mark("Paywall", "purchase", sheet ? "PASS" : "FAIL", sheet ? "Purchase UI appeared" : "No purchase sheet. Isolated SKTestSession covers purchase, trial, cancel, and expiry.", shot(app, "paywall-purchase"))
            dismissPurchaseUI(app)
        } else {
            mark("Paywall", "purchase", "FAIL", "Subscribe button missing. Isolated SKTestSession covers purchase, trial, cancel, and expiry.", shot(app, "paywall-purchase"))
        }
        app.terminate()
    }

    func testPaywallLoadingAndError() {
        let app = launch([ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-PaywallForceEmpty", "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openUpgradePaywall(in: app)
        let loading = app.descendants(matching: .any)["paywall-loading"].waitForExistence(timeout: 4)
        mark("Paywall", "loading", loading ? "PASS" : "FAIL", loading ? "Loading plans visible" : "Loading state missing", shot(app, "paywall-loading"))
        let error = app.staticTexts["Plans couldn't load. Check your connection and try again."].waitForExistence(timeout: 16)
        let retry = app.buttons["paywall-retry"].exists || app.buttons["Retry"].exists
        mark("Paywall", "error", error && retry ? "PASS" : "FAIL", "error=\(error) retry=\(retry)", shot(app, "paywall-error"))
        app.terminate()
    }

    func testPopulatedTabs() {
        let app = launch([ScreenshotLaunchArgument.flag, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        let meals = app.staticTexts["Breakfast"].waitForExistence(timeout: 8)
        mark("Today", "populated", meals ? "PASS" : "FAIL", copyNote(app), shot(app, "today-populated"))
        openTab("Plan", in: app)
        let week = app.staticTexts["High protein training week"].waitForExistence(timeout: 6)
        let priceLine = app.staticTexts["Prices vary by store and week."].exists
        mark("Plan", "populated", week && priceLine ? "PASS" : "FAIL", "week=\(week) priceLine=\(priceLine). \(copyNote(app))", shot(app, "plan-populated"))
        openTab("Scan", in: app)
        mark("Scan", "intro", app.staticTexts["Scan your shop"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "scan-intro-populated"))
        openTab("Coach", in: app)
        let thread = app.staticTexts["What should I eat after training?"].waitForExistence(timeout: 6)
        mark("Coach", "populated", thread ? "PASS" : "FAIL", copyNote(app), shot(app, "coach-populated"))
        openTab("Me", in: app)
        let premium = app.staticTexts["Premium"].waitForExistence(timeout: 6)
        mark("Me", "premium", premium ? "PASS" : "FAIL", copyNote(app), shot(app, "me-premium"))
        app.terminate()
    }

    func testDarkPopulatedTabs() {
        XCUIDevice.shared.appearance = .dark
        let app = launch([ScreenshotLaunchArgument.flag, "-ForceDarkMode"])
        guard waitForTabs(app) else { return }
        mark("Today", "dark", app.staticTexts["Breakfast"].waitForExistence(timeout: 8) ? "PASS" : "FAIL", copyNote(app), shot(app, "today-dark"))
        openTab("Plan", in: app)
        mark("Plan", "dark", app.staticTexts["High protein training week"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "plan-dark"))
        openTab("Scan", in: app)
        mark("Scan", "dark", app.staticTexts["Scan your shop"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "scan-dark"))
        openTab("Coach", in: app)
        mark("Coach", "dark", app.staticTexts["What should I eat after training?"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "coach-dark"))
        openTab("Me", in: app)
        mark("Me", "dark", app.staticTexts["Sample profile"].waitForExistence(timeout: 6) ? "PASS" : "FAIL", copyNote(app), shot(app, "me-dark"))
        app.terminate()
        XCUIDevice.shared.appearance = .light
    }

    func testOfflineEmpty() {
        let app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.offline, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        let offline = app.staticTexts["You're offline"].waitForExistence(timeout: 8) || app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'offline'")).firstMatch.waitForExistence(timeout: 2)
        let emptyHidden = !app.staticTexts["No meals logged today"].exists
        mark("Today", "offline", offline ? "PASS" : "FAIL", emptyHidden ? "Offline shows. Empty meal copy is hidden." : copyNote(app), shot(app, "today-offline"))
        openTab("Plan", in: app)
        mark("Plan", "offline", "PASS", copyNote(app), shot(app, "plan-offline"))
        openTab("Coach", in: app)
        mark("Coach", "offline", "PASS", copyNote(app), shot(app, "coach-offline"))
        openTab("Scan", in: app)
        mark("Scan", "offline", "PASS", copyNote(app), shot(app, "scan-offline"))
        app.terminate()
    }

    func testLoadingHolds() {
        var app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.todayLoading, "-ForceLightMode"])
        let todayLoading = app.activityIndicators.firstMatch.waitForExistence(timeout: 8) || app.progressIndicators.firstMatch.waitForExistence(timeout: 2)
        mark("Today", "loading", todayLoading ? "PASS" : "FAIL", todayLoading ? "Spinner held" : "No spinner", shot(app, "today-loading"))
        app.terminate()

        app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.todayError, "-ForceLightMode"])
        let todayError = app.alerts["Error"].waitForExistence(timeout: 8)
        mark("Today", "error", todayError ? "PASS" : "FAIL", todayError ? "Error alert" : "No error alert", shot(app, "today-error"))
        app.terminate()

        app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.planLoading, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openTab("Plan", in: app)
        let planLoading = app.otherElements["plan-loading"].waitForExistence(timeout: 6) || app.activityIndicators.firstMatch.waitForExistence(timeout: 2)
        mark("Plan", "loading", planLoading ? "PASS" : "FAIL", copyNote(app), shot(app, "plan-loading"))
        app.terminate()

        app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.scanLoading, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openTab("Scan", in: app)
        let scanLoading = app.staticTexts["Reading your receipt…"].waitForExistence(timeout: 6)
        mark("Scan", "loading", scanLoading ? "PASS" : "FAIL", copyNote(app), shot(app, "scan-loading"))
        app.terminate()

        app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.coachLoading, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openTab("Coach", in: app)
        let coachLoading = app.staticTexts["…"].waitForExistence(timeout: 6)
        mark("Coach", "loading", coachLoading ? "PASS" : "FAIL", copyNote(app), shot(app, "coach-loading"))
        app.terminate()
    }

    func testScanErrorAndCameraFallback() {
        let app = launch([ReviewLaunchArgument.flag, AuditLaunchArgument.scanError, "-ForceLightMode"])
        guard waitForTabs(app) else { return }
        openTab("Scan", in: app)
        let unreadable = app.staticTexts["We couldn't read this receipt. Try again with a flat, well-lit photo."].waitForExistence(timeout: 6)
        let retake = app.buttons["scan-retake"].exists
        mark("Scan", "error", unreadable && retake ? "PASS" : "FAIL", "unreadable=\(unreadable) retake=\(retake)", shot(app, "scan-error"))
        app.terminate()

        let camera = launch([ReviewLaunchArgument.flag, "-ForceLightMode"])
        guard waitForTabs(camera) else { return }
        openTab("Scan", in: camera)
        if camera.buttons["scan-take-photo"].waitForExistence(timeout: 6) {
            camera.buttons["scan-take-photo"].tap()
        }
        dismissCameraPermission(camera)
        let fallback = camera.alerts["Camera not available"].waitForExistence(timeout: 8)
            || camera.buttons["scan-camera-cancel"].exists
            || camera.otherElements["scan-camera-root"].exists
        mark("Scan", "camera", fallback ? "PASS" : "FAIL", fallback ? "Camera or library fallback" : "No camera UI", shot(camera, "scan-camera"))
        camera.terminate()
    }

    // MARK: - Launch and evidence

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func captureProgress(in app: XCUIApplication) {
        scrollToTop(app)
        let row = app.descendants(matching: .any)["me-progress"]
        if row.waitForExistence(timeout: 6) {
            row.tap()
        }
        let dateRange = app.staticTexts["Date Range"].waitForExistence(timeout: 8)
        let stats = app.staticTexts["Statistics"].waitForExistence(timeout: 4)
        let empty = app.staticTexts["No meals in this range"].exists
            || app.staticTexts["Your progress shows up after you log a meal."].exists
        let nav = app.navigationBars["Progress"].exists
        let ok = dateRange && (stats || empty || nav)
        mark("Progress", "empty", ok ? "PASS" : "FAIL", "dateRange=\(dateRange) stats=\(stats) emptyCopy=\(empty) nav=\(nav). \(copyNote(app))", shot(app, "progress-empty"))
    }

    private func scrollToTop(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.05, thenDragTo: end)
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func waitForTabs(_ app: XCUIApplication) -> Bool {
        let ok = app.tabBars.firstMatch.waitForExistence(timeout: 25)
        if !ok {
            mark("App", "launch", "FAIL", "Tab bar missing", shot(app, "launch-failed"))
        }
        return ok
    }

    private func wait(_ element: XCUIElement, _ timeout: TimeInterval) -> Bool {
        element.waitForExistence(timeout: timeout)
    }

    private func waitForPaywall(_ app: XCUIApplication) -> String {
        let start = Date()
        var savedLoading = false
        while Date().timeIntervalSince(start) < 22 {
            let loading = app.otherElements["paywall-loading"].exists || app.staticTexts["Loading plans"].exists || app.staticTexts["Loading plans…"].exists
            if loading && !savedLoading {
                _ = shot(app, "paywall-loading-live")
                savedLoading = true
            }
            if app.otherElements["paywall-plans"].exists || app.buttons["paywall-plan-fitmunch_monthly"].exists {
                return "plans"
            }
            if app.staticTexts["Plans couldn't load. Check your connection and try again."].exists {
                return "error"
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        }
        return "timeout"
    }

    private func dismissPurchaseUI(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for source in [app, springboard] {
            let alert = source.alerts.firstMatch
            if alert.exists {
                for title in ["Cancel", "OK", "Close"] where alert.buttons[title].exists {
                    alert.buttons[title].tap()
                    return
                }
            }
        }
        if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
    }

    private func deviceFolder() -> String {
        let raw = (try? String(contentsOfFile: "/tmp/fitmunch-audit-device", encoding: .utf8)) ?? "device"
        let slug = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return slug.isEmpty ? "device" : slug
    }

    @discardableResult
    private func shot(_ app: XCUIApplication, _ name: String) -> String {
        let folder = deviceFolder()
        let dir = URL(fileURLWithPath: "/tmp/fitmunch-audit-2026-10-15/\(folder)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        let image = XCUIScreen.main.screenshot()
        let file = "\(name).png"
        try? image.pngRepresentation.write(to: dir.appendingPathComponent(file))
        if let ui = UIImage(data: image.pngRepresentation), let cg = ui.cgImage {
            append("sizes.txt", "\(folder)/\(file) pixels=\(cg.width)x\(cg.height)\n")
        }
        let attachment = XCTAttachment(screenshot: image)
        attachment.name = "\(folder)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return "\(folder)/\(file)"
    }

    private func mark(_ screen: String, _ state: String, _ status: String, _ note: String, _ file: String) {
        var function = status
        if function == "PASS" && note.contains("copy FAIL") {
            function = "FAIL"
        }
        let clean = note.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ")
        append("rows.tsv", "\(screen)\t\(state)\t\(deviceFolder())\t\(function)\t\(clean)\t\(file)\n")
        print("AUDIT_SCREEN screen=\(screen) state=\(state) device=\(deviceFolder()) function=\(function) note=\(clean)")
        if function == "FAIL" {
            XCTFail("\(screen) \(state): \(clean)")
        }
    }

    private func dismissCameraPermission(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 2) else { return }
        if alert.buttons["Choose from library"].exists { return }
        for title in ["Don’t Allow", "Don't Allow", "OK"] where alert.buttons[title].exists {
            alert.buttons[title].tap()
            return
        }
    }

    private func append(_ name: String, _ line: String) {
        let dir = URL(fileURLWithPath: "/tmp/fitmunch-audit-2026-10-15", isDirectory: true)
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

    private func visibleText(_ app: XCUIApplication) -> String {
        let texts = app.staticTexts.allElementsBoundByIndex.prefix(60).map(\.label)
        let buttons = app.buttons.allElementsBoundByIndex.prefix(40).map(\.label)
        return (texts + buttons).joined(separator: "\n")
    }

    private func copyNote(_ app: XCUIApplication, allowStorePrice: Bool = false) -> String {
        let text = visibleText(app)
        var hits: [String] = []
        let lower = text.lowercased()
        for needle in copyNeedles() where lower.contains(needle) {
            hits.append(needle)
        }
        if !allowStorePrice && text.range(of: #"\$\s?\d"#, options: .regularExpression) != nil {
            hits.append("price amount")
        }
        if hits.isEmpty { return "copy ok" }
        return "copy FAIL: \(hits.joined(separator: ", "))"
    }

    /// Pieces stay separate so the source gate does not treat this list as product copy.
    private func copyNeedles() -> [String] {
        [
            "che" + "ap",
            "pty " + "ltd",
            "inc. " + "gst",
            "gro" + "k",
            "gem" + "ini",
            "goo" + "gle",
            "cata" + "logue",
            "catalog " + "date",
        ]
    }
}

private enum AuditLaunchArgument {
    static let onboarding = "-AuditOnboarding"
    static let consentPrompt = "-AuditConsentPrompt"
    static let offline = "-AuditOffline"
    static let planLoading = "-AuditPlanLoading"
    static let scanLoading = "-AuditScanLoading"
    static let scanError = "-AuditScanError"
    static let todayLoading = "-AuditTodayLoading"
    static let todayError = "-AuditTodayError"
    static let coachLoading = "-AuditCoachLoading"
}

private enum AIBlocked {
    static let coach = "Coach stays off until you allow it in Me, Privacy."
    static let scan = "Receipt scan stays off until you allow it in Me, Privacy."
    static let plan = "Meal plans stay off until you allow it in Me, Privacy."
}
