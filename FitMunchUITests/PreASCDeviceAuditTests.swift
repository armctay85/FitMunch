import XCTest

/// PRE-ASC device audit rows A–G.
/// Local FitMunchProducts.storekit (FitMunchStoreKit scheme) makes plan prices deterministic.
/// Evidence class is CI macos Simulator. Not a physical device walk.
final class PreASCDeviceAuditTests: XCTestCase {
    private let loadFailure = "Plans couldn't load. Check your connection and try again."

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// A: First run shows the account screen and does not crash.
    func testA_FirstRun() throws {
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()
        let firstRun = app.staticTexts["Your AI health partner"].waitForExistence(timeout: 20)
            || app.buttons["Create Free Account"].waitForExistence(timeout: 4)
            || app.buttons["Sign In"].waitForExistence(timeout: 2)
        XCTAssertTrue(firstRun, "A FAIL: first run did not show the account screen")
        XCTAssertEqual(app.state, .runningForeground, "A FAIL: app left the foreground")
        let shot = saveAuditScreen(app, baseName: "A-first-run")
        recordAudit(row: "A", status: "PASS", screenshot: shot)
    }

    /// B: Scan → Take a photo uses SafeCameraPicker or the library fallback.
    func testB_ScanAndTakePhoto() throws {
        let app = try launchReview()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openTab("Scan", in: app)
        XCTAssertTrue(
            app.staticTexts["Scan your shop"].waitForExistence(timeout: 8)
                || app.navigationBars["Receipt Scanner"].waitForExistence(timeout: 2),
            "B FAIL: Scan screen did not appear"
        )

        let library = firstExisting([
            app.buttons["scan-choose-library"],
            app.buttons["Choose from library"],
        ])
        XCTAssertNotNil(library, "B FAIL: Choose from library missing on Scan")

        let takePhoto = firstExisting([
            app.buttons["scan-take-photo"],
            app.buttons["Take a photo"],
        ])
        XCTAssertNotNil(takePhoto, "B FAIL: Take a photo missing on Scan")
        takePhoto?.tap()
        // The shared helper taps any OK, including this alert's OK, which
        // removes the fallback before the recovery check. Leave that alert up.
        dismissPermissionWithoutClosingCameraFallback(in: app)

        // The Scan screen's Choose from library is already on screen, so it is
        // not proof that Take a photo recovered. Require the fallback alert or
        // SafeCameraPicker chrome.
        let recovered = app.alerts["Camera not available"].waitForExistence(timeout: 10)
            || app.buttons["scan-camera-cancel"].waitForExistence(timeout: 2)
            || app.otherElements["scan-camera-root"].waitForExistence(timeout: 2)
        XCTAssertTrue(recovered, "B FAIL: neither SafeCameraPicker chrome nor library fallback appeared")
        XCTAssertEqual(app.state, .runningForeground, "B FAIL: app died after Take a photo")
        XCTAssertFalse(
            app.otherElements["UIImagePickerController"].exists,
            "B FAIL: UIImagePickerController appeared on the camera path"
        )
        let shot = saveAuditScreen(app, baseName: "B-scan-take-photo")

        // Same order as testG: OK first. The alert's Choose from library already
        // presents the photo picker, so a second tap on scan-choose-library sits
        // behind that picker and fails as not hittable (iPad).
        var openedLibraryFromAlert = false
        if app.alerts["Camera not available"].exists {
            let alert = app.alerts["Camera not available"]
            if alert.buttons["OK"].exists {
                alert.buttons["OK"].tap()
            } else if alert.buttons["Choose from library"].exists {
                alert.buttons["Choose from library"].tap()
                openedLibraryFromAlert = true
            }
        } else if app.buttons["scan-camera-cancel"].exists {
            app.buttons["scan-camera-cancel"].tap()
        }

        if openedLibraryFromAlert {
            sleep(1)
            XCTAssertEqual(app.state, .runningForeground, "B FAIL: app died after Choose from library")
            recordAudit(row: "B", status: "PASS", screenshot: shot)
            return
        }

        if let library, !library.isHittable {
            let ready = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "isHittable == true"),
                object: library
            )
            _ = XCTWaiter.wait(for: [ready], timeout: 4)
        }
        library?.tap()
        sleep(1)
        XCTAssertEqual(app.state, .runningForeground, "B FAIL: app died after Choose from library")
        recordAudit(row: "B", status: "PASS", screenshot: shot)
    }

    /// C: Settings Upgrade and Upgrade to Premium both open the paywall.
    func testC_UpgradeOpensPaywall() throws {
        let app = try launchReview()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openUpgradePaywall(in: app)
        XCTAssertTrue(paywallIsShowing(in: app), "C FAIL: paywall missing")
        XCTAssertEqual(app.state, .runningForeground, "C FAIL: app died after Upgrade")
        let shot = saveAuditScreen(app, baseName: "C-upgrade-paywall")

        let close = app.buttons["paywall-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 4), "C FAIL: Close missing")
        close.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 6), "C FAIL: tab bar missing after close")

        // settings-upgrade-premium is the Subscription row. On iPhone a full
        // swipeUp can leave it under the nav bar (exists, not hittable) and the
        // next swipe drops it out of the SwiftUI list. Scroll until that row is hittable.
        let premiumRow = scrollUntilHittable([
            app.buttons["settings-upgrade-premium"],
            app.buttons["Upgrade to Premium"],
            app.staticTexts["Upgrade to Premium"],
        ], in: app)
        XCTAssertNotNil(premiumRow, "C FAIL: Upgrade to Premium missing")
        premiumRow?.tap()
        let again = app.buttons["paywall-close"].waitForExistence(timeout: 8)
            || app.staticTexts["Unlock Premium Features"].waitForExistence(timeout: 2)
        XCTAssertTrue(again, "C FAIL: Upgrade to Premium did not open the paywall")
        XCTAssertEqual(app.state, .runningForeground)
        recordAudit(row: "C", status: "PASS", screenshot: shot)
    }

    /// D: Local StoreKit configuration loads monthly and annual prices.
    func testD_PlansLoadAndShowPrices() throws {
        let app = try launchReview()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openUpgradePaywall(in: app)

        let monthly = waitForPlanCard(app, id: "fitmunch_monthly", timeout: 20)
        let annual = waitForPlanCard(app, id: "fitmunch_annual", timeout: 4)
        XCTAssertNotNil(monthly, "D FAIL: monthly plan did not load from the local StoreKit configuration")
        XCTAssertNotNil(annual, "D FAIL: annual plan did not load from the local StoreKit configuration")
        if let monthly { reveal(monthly, in: app) }
        let monthlyPrice = app.staticTexts["paywall-price-fitmunch_monthly"]
        let annualPrice = app.staticTexts["paywall-price-fitmunch_annual"]
        let monthlyLabel = [monthly?.label, monthlyPrice.exists ? monthlyPrice.label : nil]
            .compactMap { $0 }
            .joined(separator: " ")
        let annualLabel = [annual?.label, annualPrice.exists ? annualPrice.label : nil]
            .compactMap { $0 }
            .joined(separator: " ")
        XCTAssertTrue(monthlyLabel.contains("19.99"), "D FAIL: monthly price missing from \(monthlyLabel)")
        XCTAssertTrue(annualLabel.contains("149.99"), "D FAIL: annual price missing from \(annualLabel)")
        XCTAssertFalse(app.staticTexts["Weekly Premium"].exists, "D FAIL: weekly plan is on the paywall")
        XCTAssertFalse(app.buttons["paywall-retry"].exists, "D FAIL: retry error showing while plans loaded")
        XCTAssertEqual(app.state, .runningForeground)
        let shot = saveAuditScreen(app, baseName: "D-plans-prices")
        recordAudit(row: "D", status: "PASS", screenshot: shot)
    }

    /// E: A failed fetch shows the retry state, not a blank paywall.
    func testE_FailedFetchShowsRetry() throws {
        let app = try launchReview(extra: ["-PaywallForceEmpty"], localStoreKit: false)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openUpgradePaywall(in: app)

        let sawLoading = app.staticTexts["paywall-load-phase"].waitForExistence(timeout: 8)
            || app.staticTexts["Loading plans"].waitForExistence(timeout: 2)
            || app.staticTexts["Loading plans…"].exists
            || app.otherElements["paywall-loading"].exists
        XCTAssertTrue(sawLoading, "E FAIL: paywall did not show a loading state")

        let error = app.staticTexts[loadFailure]
        XCTAssertTrue(error.waitForExistence(timeout: 12), "E FAIL: retry copy did not appear")
        reveal(error, in: app)
        let retry = scrollUntilAnyExists([
            app.buttons["paywall-retry"],
        ], in: app) ?? app.buttons["paywall-retry"]
        XCTAssertTrue(retry.exists, "E FAIL: Retry missing")
        XCTAssertTrue(
            app.buttons["paywall-restore"].exists || app.buttons["paywall-restore-inline"].exists || app.buttons["Restore Purchases"].exists,
            "E FAIL: Restore Purchases missing on the error state"
        )
        XCTAssertTrue(app.staticTexts["Unlock Premium Features"].exists, "E FAIL: paywall header missing (blank screen)")
        XCTAssertFalse(app.staticTexts["Premium plans did not load from the App Store."].exists)
        XCTAssertFalse(app.otherElements["paywall-plans"].exists, "E FAIL: plans rendered on the forced-empty path")

        reveal(retry, in: app)
        retry.tap()
        _ = app.staticTexts["Loading plans…"].waitForExistence(timeout: 2)
        XCTAssertTrue(error.waitForExistence(timeout: 12), "E FAIL: Retry did not return to the error state")
        XCTAssertEqual(app.state, .runningForeground, "E FAIL: app died on the empty fetch path")
        let shot = saveAuditScreen(app, baseName: "E-retry")
        recordAudit(row: "E", status: "PASS", screenshot: shot)
    }

    /// F: Restore Purchases returns to the paywall without a crash.
    func testF_RestorePurchases() throws {
        let app = try launchReview()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        openUpgradePaywall(in: app)
        let restore = app.buttons["paywall-restore"]
        XCTAssertTrue(restore.waitForExistence(timeout: 8), "F FAIL: Restore Purchases missing")
        reveal(restore, in: app)
        restore.tap()
        let alert = app.alerts["Restore Purchases"]
        XCTAssertTrue(alert.waitForExistence(timeout: 15), "F FAIL: restore did not finish")
        XCTAssertEqual(app.state, .runningForeground, "F FAIL: app died during restore")
        let shot = saveAuditScreen(app, baseName: "F-restore")
        if alert.buttons["OK"].exists {
            alert.buttons["OK"].tap()
        }
        XCTAssertTrue(paywallIsShowing(in: app), "F FAIL: paywall gone after restore")
        recordAudit(row: "F", status: "PASS", screenshot: shot)
    }

    /// G: Upgrade, scan, and dismiss leave the app in the foreground.
    func testG_NoCrash() throws {
        let app = try launchReview()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20), "G FAIL: tab bar missing")
        openTab("Home", in: app)
        openTab("Coach", in: app)
        openUpgradePaywall(in: app)
        let close = app.buttons["paywall-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 6))
        close.tap()
        openTab("Scan", in: app)
        let takePhoto = firstExisting([
            app.buttons["scan-take-photo"],
            app.buttons["Take a photo"],
        ])
        takePhoto?.tap()
        dismissSystemAlerts(in: app)
        if app.alerts["Camera not available"].waitForExistence(timeout: 6) {
            let alert = app.alerts["Camera not available"]
            if alert.buttons["OK"].exists {
                alert.buttons["OK"].tap()
            } else if alert.buttons["Choose from library"].exists {
                alert.buttons["Choose from library"].tap()
            }
        } else if app.buttons["scan-camera-cancel"].exists {
            app.buttons["scan-camera-cancel"].tap()
        }
        XCTAssertEqual(app.state, .runningForeground, "G FAIL: app is not running")
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 6) || paywallIsShowing(in: app))
        let shot = saveAuditScreen(app, baseName: "G-no-crash")
        recordAudit(row: "G", status: "PASS", screenshot: shot)
    }

    /// Permission sheets use Allow, Don't Allow, or a bare OK.
    /// "Camera not available" also has OK. Tapping that OK dismisses the
    /// fallback the recovery assertion has to see.
    private func dismissPermissionWithoutClosingCameraFallback(in app: XCUIApplication) {
        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 1.2) else { return }
        if app.alerts["Camera not available"].exists || alert.buttons["Choose from library"].exists {
            return
        }
        for title in ["Don’t Allow", "Don't Allow", "Allow", "OK", "Close"] {
            let button = alert.buttons[title]
            if button.exists {
                button.tap()
                return
            }
        }
    }

    private func launchReview(extra: [String] = [], localStoreKit: Bool = true) throws -> XCUIApplication {
        let app = XCUIApplication()
        var args = [ReviewLaunchArgument.flag]
        if localStoreKit {
            args.append("-UseLocalStoreKit")
        }
        args.append(contentsOf: extra)
        app.launchArguments = args
        app.launch()
        return app
    }
}
