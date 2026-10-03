import XCTest

/// Price memory screens. Separate from the App Store screenshot set, which must stay free of prices.
final class PriceMemoryUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testPlanEmptyState() {
        let app = launch("-PriceMemoryEmpty")
        XCTAssertTrue(app.descendants(matching: .any)["plan-price-empty"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Your prices, from your receipts."].exists)
    }

    func testPlanMemo() {
        let app = launch("-PriceMemoryData", "-PriceMemoryDark")
        let memo = app.descendants(matching: .any)["plan-price-memo"]
        XCTAssertTrue(memo.waitForExistence(timeout: 8))
        XCTAssertTrue(memo.label.contains("paid"))
    }

    func testPlanMemoAtExtraLargeType() {
        let app = XCUIApplication()
        app.launchArguments = ["-PriceMemoryData", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXL"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["plan-price-memo"].waitForExistence(timeout: 8))
    }

    func testSettingsToggleOffConfirmsDelete() {
        let app = launch("-PriceMemorySettings")
        let toggle = app.switches["pm-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 8))
        toggle.tap()
        XCTAssertTrue(app.staticTexts["Turn off and delete 4 saved prices?"].waitForExistence(timeout: 4))
        app.buttons["Keep it for now"].tap()
    }

    func testDeleteReceiptRow() {
        let app = launch("-PriceMemorySettings")
        let row = app.descendants(matching: .any)["pm-receipt-row"]
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 3))
    }

    func testScanSavedBannerAndOptInSheet() {
        let saved = launch("-PriceMemoryScanSaved")
        XCTAssertTrue(saved.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Saved'")).firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(saved.buttons["Undo"].exists)

        let optIn = launch("-PriceMemoryScanOptIn")
        XCTAssertTrue(optIn.staticTexts["Remember what you paid?"].waitForExistence(timeout: 8))
        optIn.buttons["Turn on price memory"].firstMatch.tap()
        XCTAssertTrue(optIn.staticTexts["Prices older than 18 months are deleted automatically."].waitForExistence(timeout: 4))
        XCTAssertTrue(optIn.buttons["Not now"].exists)
    }

    private func launch(_ args: String...) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = args
        app.launch()
        return app
    }
}
