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

    func testAnnualPerWeekAndSavingsComeFromAmounts() {
        let monthly = Decimal(string: "19.99")!
        let annual = Decimal(string: "149.99")!
        let week = NSDecimalNumber(decimal: PaywallPricing.perWeekAmount(annual: annual)).doubleValue
        XCTAssertEqual(week, 2.88, accuracy: 0.01)
        XCTAssertEqual(PaywallPricing.savingsPercent(monthly: monthly, annual: annual), 37)
        let label = PaywallPricing.perWeekLabel(annual: annual, currencyCode: "AUD")
        XCTAssertNotNil(label)
        XCTAssertTrue(label?.contains("2.88") == true)
        XCTAssertTrue(label?.hasSuffix("/wk") == true)
        XCTAssertNil(PaywallPricing.savingsPercent(monthly: monthly, annual: monthly * 12))
    }

    func testSubscribeCopyWhenIntroMissingOrIneligible() {
        let ineligible = PaywallPricing.cta(
            displayPrice: "A$19.99",
            periodUnit: .month,
            intro: PaywallIntroOffer(periodUnit: .day, periodValue: 14, isFreeTrial: true),
            eligible: false
        )
        XCTAssertEqual(ineligible.title, "Subscribe for A$19.99/month")
        XCTAssertNil(ineligible.subline)

        let noOffer = PaywallPricing.cta(
            displayPrice: "A$149.99",
            periodUnit: .year,
            intro: nil,
            eligible: true
        )
        XCTAssertEqual(noOffer.title, "Subscribe for A$149.99/year")
        XCTAssertNil(noOffer.subline)
        XCTAssertNil(PaywallPricing.trialTimeline(intro: nil, eligible: true))
        XCTAssertNil(
            PaywallPricing.trialTimeline(
                intro: PaywallIntroOffer(periodUnit: .day, periodValue: 14, isFreeTrial: true),
                eligible: false
            )
        )
    }

    func testTrialCopyWhenEligibleForIntro() {
        let intro = PaywallIntroOffer(periodUnit: .day, periodValue: 14, isFreeTrial: true)
        let cta = PaywallPricing.cta(
            displayPrice: "A$19.99",
            periodUnit: .month,
            intro: intro,
            eligible: true
        )
        XCTAssertEqual(cta.title, "Start 14-day free trial")
        XCTAssertEqual(cta.subline, "then A$19.99/month · cancel anytime")
        let timeline = PaywallPricing.trialTimeline(intro: intro, eligible: true)
        XCTAssertEqual(timeline?.today, "Today full access")
        XCTAssertEqual(timeline?.billed, "Day 14 billed")
        XCTAssertFalse(PaywallPricing.renewalTerms(
            displayPrice: "A$19.99",
            periodUnit: .month,
            intro: intro,
            eligible: true
        ).contains("remind"))
    }

    func testPricePeriodAndRenewalUseThePassedStoreKitValues() {
        XCTAssertEqual(
            PaywallPricing.priceWithPeriod(displayPrice: "A$149.99", periodUnit: .year),
            "A$149.99/year"
        )
        XCTAssertEqual(
            PaywallPricing.priceWithPeriod(displayPrice: "A$19.99", periodUnit: .month),
            "A$19.99/month"
        )
        let intro = PaywallIntroOffer(periodUnit: .day, periodValue: 14, isFreeTrial: true)
        XCTAssertEqual(
            PaywallPricing.renewalTerms(
                displayPrice: "A$149.99",
                periodUnit: .year,
                intro: intro,
                eligible: true
            ),
            "14-day free trial, then A$149.99/year. Renews automatically. Cancel anytime in Settings."
        )
        XCTAssertEqual(
            PaywallPricing.renewalTerms(
                displayPrice: "A$19.99",
                periodUnit: .month,
                intro: intro,
                eligible: false
            ),
            "A$19.99/month. Renews automatically. Cancel anytime in Settings."
        )
    }
}
