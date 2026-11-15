import StoreKitTest
import UIKit
import XCTest

/// Test-only B/D/F audit. Signs in with the App Review demo account from
/// /tmp/fitmunch-qa-credentials. Never logs or screenshots those credentials.
/// Do not merge this file to main.
final class BDFDemoAuditUITests: XCTestCase {
    private let outDir = URL(fileURLWithPath: "/tmp/bdf-demo-audit", isDirectory: true)
    private var storeKit: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let url = try XCTUnwrap(
            Bundle(for: BDFDemoAuditUITests.self)
                .url(forResource: "FitMunchProducts", withExtension: "storekit"),
            "FitMunchProducts.storekit is not in the UI test bundle"
        )
        let session = try SKTestSession(contentsOf: url)
        session.disableDialogs = true
        session.resetToDefaultState()
        session.clearTransactions()
        session.storefront = "AUS"
        session.locale = Locale(identifier: "en_AU")
        storeKit = session
        XCTAssertEqual(session.storefront, "AUS", "D FAIL: StoreKit session is not the AU storefront")
    }

    func testBDF_DemoAccountScanAndStoreKit() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UseLocalStoreKit", "-ForceLightMode"]
        app.launch()

        try signInWithDemoAccount(in: app)
        XCTAssertEqual(Int(app.frame.width.rounded()), 390, "App width is not 390pt")

        // F: Me > Upgrade, plans visible.
        openUpgradePaywall(in: app)
        XCTAssertTrue(paywallIsShowing(in: app), "F FAIL: paywall missing after Me > Upgrade")
        let monthly = waitForPrice(in: app, id: "paywall-price-fitmunch_monthly")
        let annual = waitForPrice(in: app, id: "paywall-price-fitmunch_annual")
        XCTAssertTrue(priceShows(monthly, amount: "19.99"), "F/D FAIL: monthly is not 19.99 (\(monthly.label))")
        XCTAssertTrue(priceShows(annual, amount: "149.99"), "F/D FAIL: annual is not 149.99 (\(annual.label))")
        saveShot(app, "F-demo-sign-in-upgrade-390")
        saveShot(app, "D-storekit-prices-390")
        writeNote("F PASS: demo sign-in reached Me > Upgrade; plans visible")
        writeNote("D prices on screen: monthly=\(monthly.label) annual=\(annual.label)")

        // D: Restore either works or explains there is nothing to restore.
        let restore = firstExisting([
            app.buttons["paywall-restore"],
            app.buttons["paywall-restore-inline"],
            app.buttons["Restore Purchases"],
        ])
        XCTAssertNotNil(restore, "D FAIL: Restore Purchases missing")
        if let restore, !restore.isHittable {
            reveal(restore, in: app)
        }
        restore?.tap()
        let alert = app.alerts["Restore Purchases"]
        XCTAssertTrue(alert.waitForExistence(timeout: 20), "D FAIL: restore did not finish")
        let restoreBody = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        let restoreOk = restoreBody.contains("Purchases restored successfully")
            || restoreBody.contains("No purchases to restore")
            || alert.label.contains("Purchases restored successfully")
            || alert.label.contains("No purchases to restore")
        XCTAssertTrue(restoreOk, "D FAIL: restore alert did not confirm or explain empty")
        saveShot(app, "D-restore-390")
        writeNote("D PASS: restore alert visible")
        if alert.buttons["OK"].exists {
            alert.buttons["OK"].tap()
        }
        let close = app.buttons["paywall-close"]
        if close.waitForExistence(timeout: 4) {
            close.tap()
        }
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 8), "Tab bar missing after closing the paywall")

        // B: Scan, allow the camera prompt, complete photo-pick to a result.
        openTab("Scan", in: app)
        allowConsentIfNeeded(in: app)
        XCTAssertTrue(
            app.staticTexts["Scan your shop"].waitForExistence(timeout: 8)
                || app.navigationBars["Receipt Scanner"].waitForExistence(timeout: 2),
            "B FAIL: Scan screen did not appear"
        )
        let takePhoto = firstExisting([
            app.buttons["scan-take-photo"],
            app.buttons["Take a photo"],
        ])
        XCTAssertNotNil(takePhoto, "B FAIL: Take a photo missing on Scan")
        takePhoto?.tap()
        allowCameraPrompt(in: app)
        let cameraPrompt = app.alerts["Camera not available"]
        XCTAssertTrue(
            cameraPrompt.waitForExistence(timeout: 12)
                || app.buttons["scan-camera-cancel"].waitForExistence(timeout: 2)
                || app.otherElements["scan-camera-root"].waitForExistence(timeout: 2),
            "B FAIL: camera prompt or camera chrome did not appear"
        )
        saveShot(app, "B-camera-prompt-390")

        if cameraPrompt.exists {
            let choose = cameraPrompt.buttons["Choose from library"]
            XCTAssertTrue(choose.waitForExistence(timeout: 4), "B FAIL: Choose from library missing on the camera prompt")
            choose.tap()
        } else if app.buttons["scan-camera-cancel"].exists {
            app.buttons["scan-camera-cancel"].tap()
            let library = firstExisting([
                app.buttons["scan-choose-library"],
                app.buttons["Choose from library"],
            ])
            XCTAssertNotNil(library, "B FAIL: Choose from library missing after closing the camera")
            library?.tap()
        } else {
            let library = firstExisting([
                app.buttons["scan-choose-library"],
                app.buttons["Choose from library"],
            ])
            XCTAssertNotNil(library, "B FAIL: Choose from library missing")
            library?.tap()
        }

        try pickFirstLibraryPhoto(in: app)
        let result = waitForScanOutcome(in: app)
        XCTAssertTrue(result.success, "B FAIL: photo-pick did not reach a scan result (\(result.note))")
        saveShot(app, "B-scan-result-390")
        writeNote("B PASS: \(result.note)")
        XCTAssertEqual(app.state, .runningForeground, "B FAIL: app left the foreground")
    }

    // MARK: - Sign in

    /// Uses the paste menu so the typed secret is less likely to appear in the test log.
    /// Never captures a screenshot while the auth fields are on screen.
    private func signInWithDemoAccount(in app: XCUIApplication) throws {
        let email = qaCredential("QA_EMAIL")
        let password = qaCredential("QA_PASSWORD")
        XCTAssertFalse(email.isEmpty || password.isEmpty, "F FAIL: demo credentials are not set")

        let signIn = firstExisting([
            app.segmentedControls.buttons["Sign In"],
            app.buttons["Sign In"],
            app.buttons["auth-sign-in"],
        ], timeout: 25)
        XCTAssertNotNil(signIn, "F FAIL: Sign In did not appear")
        if app.buttons["auth-sign-in"].exists == false {
            signIn?.tap()
        }
        if !app.buttons["auth-sign-in"].waitForExistence(timeout: 4) {
            if app.buttons["Sign In"].exists { app.buttons["Sign In"].tap() }
        }

        let emailField = app.textFields["auth-email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 8), "F FAIL: Email field missing")
        paste(email, into: emailField, in: app)
        let passwordField = app.secureTextFields["auth-password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 4), "F FAIL: Password field missing")
        paste(password, into: passwordField, in: app)
        UIPasteboard.general.string = ""

        if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        } else if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else if app.keyboards.buttons["Go"].exists {
            app.keyboards.buttons["Go"].tap()
        }

        let submit = app.buttons["auth-sign-in"]
        XCTAssertTrue(submit.waitForExistence(timeout: 4), "F FAIL: Sign In button missing")
        submit.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 40), "F FAIL: demo sign-in did not reach the tabs")
        XCTAssertFalse(app.secureTextFields["auth-password"].exists, "F FAIL: still on the sign-in form")
    }

    private func paste(_ value: String, into element: XCUIElement, in app: XCUIApplication) {
        UIPasteboard.general.string = value
        element.tap()
        element.press(forDuration: 1.1)
        let item = app.menuItems["Paste"]
        XCTAssertTrue(item.waitForExistence(timeout: 3), "F FAIL: Paste menu missing")
        item.tap()
    }

    // MARK: - Camera and library

    /// Allow a system camera prompt if one appears. On the simulator the
    /// app usually shows the "Camera not available" fallback instead.
    private func allowCameraPrompt(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            let system = springboard.alerts.firstMatch
            if system.exists {
                for title in ["Allow", "OK"] where system.buttons[title].exists {
                    system.buttons[title].tap()
                    return
                }
            }
            let alert = app.alerts.firstMatch
            if alert.exists, !app.alerts["Camera not available"].exists {
                for title in ["Allow", "OK"] where alert.buttons[title].exists {
                    alert.buttons[title].tap()
                    return
                }
            }
            if app.alerts["Camera not available"].exists { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
    }

    private func allowConsentIfNeeded(in app: XCUIApplication) {
        let sheet = app.descendants(matching: .any)["ai-consent-sheet"]
        guard sheet.waitForExistence(timeout: 3) else { return }
        let allow = app.buttons["ai-consent-allow"]
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
        }
    }

    private func pickFirstLibraryPhoto(in app: XCUIApplication) throws {
        let deadline = Date().addingTimeInterval(15)
        var picked = false
        while Date() < deadline, !picked {
            let services = [
                XCUIApplication(bundleIdentifier: "com.apple.PhotosUIService"),
                XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow"),
                app,
            ]
            for host in services {
                if pickPhoto(in: host) {
                    picked = true
                    break
                }
            }
            if !picked {
                RunLoop.current.run(until: Date().addingTimeInterval(0.3))
            }
        }
        XCTAssertTrue(picked, "B FAIL: could not select a library photo")
    }

    private func pickPhoto(in host: XCUIApplication) -> Bool {
        if host.buttons["Continue"].waitForExistence(timeout: 0.3), host.buttons["Continue"].isHittable {
            host.buttons["Continue"].tap()
        }
        let candidates: [XCUIElement] = [
            host.images.matching(NSPredicate(format: "identifier CONTAINS[c] %@ OR label CONTAINS[c] %@", "Photo", "Photo")).element(boundBy: 0),
            host.cells.element(boundBy: 0),
            host.images.element(boundBy: 0),
            host.otherElements["PhotosGridView"].cells.element(boundBy: 0),
            host.collectionViews.cells.element(boundBy: 0),
        ]
        for cell in candidates where cell.exists && cell.isHittable {
            cell.tap()
            let confirm = firstExisting([
                host.buttons["Add"],
                host.buttons["Choose"],
                host.buttons["Done"],
                appConfirmButtons(host),
            ], timeout: 1)
            confirm?.tap()
            return true
        }
        return false
    }

    private func appConfirmButtons(_ host: XCUIApplication) -> XCUIElement {
        host.buttons["Open"]
    }

    private func waitForScanOutcome(in app: XCUIApplication) -> (success: Bool, note: String) {
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            if app.staticTexts["Weekly haul score"].exists
                || app.buttons["Log haul to today's meals"].exists
                || app.staticTexts["Prices vary by store and week."].exists {
                return (true, "scan result is on screen")
            }
            if app.staticTexts["We couldn't read this receipt. Try again with a flat, well-lit photo."].exists
                || app.staticTexts["Scanning is unavailable right now."].exists
                || app.staticTexts["Couldn't read that image. Try another photo."].exists {
                return (false, "scan finished with a read failure, not a result")
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        return (false, "timed out waiting for a scan result")
    }

    // MARK: - Prices and shots

    private func waitForPrice(in app: XCUIApplication, id: String) -> XCUIElement {
        let element = app.staticTexts[id]
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if element.exists, element.label.contains(where: { $0.isNumber }) {
                return element
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTFail("D FAIL: \(id) did not load a price")
        return element
    }

    private func priceShows(_ element: XCUIElement, amount: String) -> Bool {
        let label = element.label
        return label.contains(amount)
    }

    private func saveShot(_ app: XCUIApplication, _ name: String) {
        XCTAssertFalse(app.secureTextFields["auth-password"].exists, "Refusing to capture a screen with the password field")
        XCTAssertFalse(app.textFields["auth-email"].exists, "Refusing to capture a screen with the email field")
        let shot = XCUIScreen.main.screenshot()
        let url = outDir.appendingPathComponent("\(name).png")
        try? shot.pngRepresentation.write(to: url)
        if let image = UIImage(data: shot.pngRepresentation), let cg = image.cgImage {
            let line = "\(name).png app=\(Int(app.frame.width.rounded()))x\(Int(app.frame.height.rounded())) pixels=\(cg.width)x\(cg.height)\n"
            writeNote(line.trimmingCharacters(in: .newlines))
        }
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func writeNote(_ line: String) {
        let url = outDir.appendingPathComponent("notes.txt")
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (text + line + "\n").write(to: url, atomically: true, encoding: .utf8)
    }
}
