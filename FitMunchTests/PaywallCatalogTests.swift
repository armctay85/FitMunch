import XCTest
@testable import FitMunch

final class PaywallCatalogTests: XCTestCase {
    func testSellableProductIDsMatchAppStoreConnect() {
        XCTAssertEqual(PaywallCatalog.monthly, "fitmunch_monthly")
        XCTAssertEqual(PaywallCatalog.annual, "fitmunch_annual")
        XCTAssertEqual(PaywallCatalog.weekly, "fitmunch_weekly")
        XCTAssertEqual(PaywallCatalog.sellable, ["fitmunch_monthly", "fitmunch_annual"])
        XCTAssertEqual(Constants.ProductIDs.sellable, PaywallCatalog.sellable)
        XCTAssertEqual(Constants.Entitlements.premium, "premium")
        XCTAssertEqual(Constants.Offerings.main, "main")
    }

    func testWeeklyMissingMetadataDoesNotBlockMonthlyAnnual() {
        let ids = PaywallCatalog.selectSellableIds(
            from: ["fitmunch_weekly", "fitmunch_monthly", "fitmunch_annual"],
            titles: [
                "fitmunch_weekly": "",
                "fitmunch_monthly": "Monthly Premium",
                "fitmunch_annual": "Annual Premium"
            ]
        )
        XCTAssertEqual(ids, ["fitmunch_monthly", "fitmunch_annual"])
    }

    func testEmptyStoreKitResponseReturnsEmptyList() {
        XCTAssertEqual(PaywallCatalog.selectSellableIds(from: []), [])
        XCTAssertEqual(
            PaywallCatalog.selectSellableIds(from: ["fitmunch_weekly"], titles: ["fitmunch_weekly": ""]),
            []
        )
    }

    func testFallbackTitleWhenStoreKitMetadataBlank() {
        XCTAssertEqual(PaywallCatalog.displayTitle(productId: "fitmunch_monthly", storeTitle: "  "), "Monthly Premium")
        XCTAssertEqual(PaywallCatalog.displayTitle(productId: "fitmunch_annual", storeTitle: "Yearly"), "Yearly")
        XCTAssertTrue(PaywallCatalog.isWeeklyMissingMetadata(productId: "fitmunch_weekly", title: ""))
        XCTAssertFalse(PaywallCatalog.isWeeklyMissingMetadata(productId: "fitmunch_monthly", title: ""))
    }
}
