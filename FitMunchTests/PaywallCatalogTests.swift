import XCTest
@testable import FitMunch

final class PaywallCatalogTests: XCTestCase {
    func testSellableProductIDsAreMonthlyAndAnnualOnly() {
        XCTAssertEqual(PaywallCatalog.monthly, "fitmunch_monthly")
        XCTAssertEqual(PaywallCatalog.annual, "fitmunch_annual")
        XCTAssertEqual(PaywallCatalog.sellable, ["fitmunch_monthly", "fitmunch_annual"])
        XCTAssertEqual(Constants.ProductIDs.sellable, PaywallCatalog.sellable)
        XCTAssertFalse(PaywallCatalog.sellable.contains("fitmunch_weekly"))
        XCTAssertFalse(Constants.ProductIDs.sellable.contains("fitmunch_weekly"))
        XCTAssertEqual(Constants.Entitlements.premium, "premium")
        XCTAssertEqual(Constants.Offerings.main, "main")
    }

    func testLegacyWeeklyIdIsNotSellable() {
        let ids = PaywallCatalog.selectSellableIds(
            from: ["fitmunch_weekly", "fitmunch_monthly", "fitmunch_annual", "fitmunch_lifetime"]
        )
        XCTAssertEqual(ids, ["fitmunch_monthly", "fitmunch_annual"])
    }

    func testEmptyStoreKitResponseReturnsEmptyList() {
        XCTAssertEqual(PaywallCatalog.selectSellableIds(from: []), [])
        XCTAssertEqual(PaywallCatalog.selectSellableIds(from: ["fitmunch_weekly"]), [])
    }

    func testFallbackTitleWhenStoreKitMetadataBlank() {
        XCTAssertEqual(PaywallCatalog.displayTitle(productId: "fitmunch_monthly", storeTitle: "  "), "Monthly Premium")
        XCTAssertEqual(PaywallCatalog.displayTitle(productId: "fitmunch_annual", storeTitle: "Yearly"), "Yearly")
        XCTAssertEqual(PaywallCatalog.displayDescription(productId: "fitmunch_annual", storeDescription: ""), "Billed once a year")
    }

    func testLoadPolicyRetriesOnceBeforeFailure() {
        XCTAssertEqual(PaywallLoadPolicy.phase(attempt: 1, hasPlans: false), .loading)
        XCTAssertEqual(PaywallLoadPolicy.phase(attempt: 2, hasPlans: false), .failed)
        XCTAssertEqual(PaywallLoadPolicy.phase(attempt: 1, hasPlans: true), .ready)
        XCTAssertEqual(PaywallLoadPolicy.maxAutomaticAttempts, 2)
        XCTAssertGreaterThanOrEqual(PaywallLoadPolicy.automaticRetryBackoffNanoseconds, 1_000_000_000)
        XCTAssertEqual(
            PaywallLoadPolicy.userFacingLoadFailure,
            "Plans couldn't load. Check your connection and try again."
        )
    }
}
