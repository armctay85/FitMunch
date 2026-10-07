import StoreKit
import StoreKitTest
import XCTest

/// Loads FitMunchProducts.storekit in this test process. Prices, periods, and the
/// intro offer have to come from that file, not from a hard-coded paywall catalog.
final class FitMunchProductsStoreKitTests: XCTestCase {
    private var session: SKTestSession!

    override func setUp() async throws {
        let url = try XCTUnwrap(
            Bundle(for: FitMunchProductsStoreKitTests.self)
                .url(forResource: "FitMunchProducts", withExtension: "storekit"),
            "FitMunchProducts.storekit is not in the test bundle"
        )
        print("STOREKIT_PROOF file=\(url.path)")
        let created = try SKTestSession(contentsOf: url)
        created.disableDialogs = true
        created.resetToDefaultState()
        session = created
    }

    func testBothProductsMatchTheStoreKitFile() async throws {
        let products = try await Product.products(for: ["fitmunch_monthly", "fitmunch_annual"])
        for product in products.sorted(by: { $0.id < $1.id }) {
            let intro = product.subscription?.introductoryOffer
            print(
                "STOREKIT_PROOF id=\(product.id) display=\(product.displayPrice) currency=\(product.priceFormatStyle.currencyCode) introMode=\(String(describing: intro?.paymentMode)) introValue=\(String(describing: intro?.period.value)) introUnit=\(String(describing: intro?.period.unit))"
            )
        }
        XCTAssertEqual(Set(products.map(\.id)), Set(["fitmunch_monthly", "fitmunch_annual"]))

        let monthly = try XCTUnwrap(products.first { $0.id == "fitmunch_monthly" })
        let annual = try XCTUnwrap(products.first { $0.id == "fitmunch_annual" })
        try await assertSubscription(monthly, price: "19.99", unit: .month)
        try await assertSubscription(annual, price: "149.99", unit: .year)
    }

    private func assertSubscription(
        _ product: Product,
        price: String,
        unit: Product.SubscriptionPeriod.Unit
    ) async throws {
        let expected = try XCTUnwrap(Decimal(string: price))
        XCTAssertEqual(
            NSDecimalNumber(decimal: product.price).doubleValue,
            NSDecimalNumber(decimal: expected).doubleValue,
            accuracy: 0.001,
            "\(product.id) price"
        )
        XCTAssertEqual(product.priceFormatStyle.currencyCode, "AUD", "\(product.id) currency")
        XCTAssertTrue(product.displayPrice.contains(price), "\(product.id) displayPrice \(product.displayPrice)")
        XCTAssertFalse(product.displayPrice.contains("12.99") && price == "19.99")
        XCTAssertFalse(product.displayPrice.contains("99.99") && price == "149.99")

        let subscription = try XCTUnwrap(product.subscription, "\(product.id) is not a subscription")
        XCTAssertEqual(subscription.subscriptionPeriod.unit, unit, "\(product.id) period")
        XCTAssertEqual(subscription.subscriptionPeriod.value, 1, "\(product.id) period count")

        let intro = try XCTUnwrap(subscription.introductoryOffer, "\(product.id) intro offer")
        XCTAssertEqual(intro.paymentMode, .freeTrial, "\(product.id) intro mode")
        XCTAssertEqual(intro.period.unit, .day, "\(product.id) intro unit")
        XCTAssertEqual(intro.period.value, 14, "\(product.id) intro length")
        XCTAssertEqual(NSDecimalNumber(decimal: intro.price).doubleValue, 0, accuracy: 0.001)

        let eligible = await subscription.isEligibleForIntroOffer
        XCTAssertTrue(eligible, "\(product.id) intro eligibility")
    }
}
