import StoreKit
import StoreKitTest
import XCTest

/// Purchase, trial, restore, cancel, and expiry for the two sellable products.
/// Runs in the simulator test process via SKTestSession. The app does not start a session.
final class StoreKitLifecycleTests: XCTestCase {
    private var session: SKTestSession!
    private var storekitURL: URL!

    override func setUp() async throws {
        let url = try XCTUnwrap(
            Bundle(for: StoreKitLifecycleTests.self)
                .url(forResource: "FitMunchProducts", withExtension: "storekit"),
            "FitMunchProducts.storekit is not in the test bundle"
        )
        storekitURL = url
        let created = try SKTestSession(contentsOf: url)
        created.disableDialogs = true
        created.resetToDefaultState()
        created.clearTransactions()
        session = created
    }

    override func tearDown() {
        session?.clearTransactions()
        session = nil
    }

    func testWeeklyNeverLoads() async throws {
        let file = try String(contentsOf: storekitURL, encoding: .utf8)
        XCTAssertFalse(file.contains("fitmunch_weekly"), "storekit file names a weekly product")
        let weekly = try await Product.products(for: ["fitmunch_weekly"])
        XCTAssertTrue(weekly.isEmpty, "fitmunch_weekly loaded from StoreKit")
        let sellable = try await Product.products(for: ["fitmunch_monthly", "fitmunch_annual"])
        XCTAssertEqual(Set(sellable.map(\.id)), Set(["fitmunch_monthly", "fitmunch_annual"]))
        print("AUDIT_STOREKIT product=fitmunch_weekly step=absent result=PASS detail=not_in_catalog")
    }

    func testMonthlyPurchaseTrialRestoreCancelExpiry() async throws {
        try await lifecycle("fitmunch_monthly")
    }

    func testAnnualPurchaseTrialRestoreCancelExpiry() async throws {
        try await lifecycle("fitmunch_annual")
    }

    private func lifecycle(_ productID: String) async throws {
        session.resetToDefaultState()
        session.clearTransactions()

        let product = try XCTUnwrap(try await Product.products(for: [productID]).first)
        let subscription = try XCTUnwrap(product.subscription, "\(productID) subscription")
        let intro = try XCTUnwrap(subscription.introductoryOffer, "\(productID) intro")
        step(productID, "trial-offer", intro.paymentMode == .freeTrial && intro.period.unit == .day && intro.period.value == 14,
             "mode=\(intro.paymentMode) unit=\(intro.period.unit) value=\(intro.period.value)")
        let eligible = await subscription.isEligibleForIntroOffer
        step(productID, "trial-eligible", eligible, "eligible=\(eligible)")

        let transaction = try await session.buyProduct(identifier: productID)
        let purchased = transaction.productID == productID
        step(productID, "purchase", purchased, "id=\(transaction.id) product=\(transaction.productID) offer=\(String(describing: transaction.offerType))")
        step(productID, "trial", transaction.offerType == .introductory, "offerType=\(String(describing: transaction.offerType))")

        var entitled = try await entitlementIDs()
        step(productID, "purchase-entitlement", entitled.contains(productID), "entitled=\(entitled.sorted().joined(separator: ","))")

        try await AppStore.sync()
        entitled = try await entitlementIDs()
        step(productID, "restore", entitled.contains(productID), "after_sync=\(entitled.sorted().joined(separator: ","))")

        let identifier = Int(transaction.id)
        XCTAssertEqual(UInt64(identifier), transaction.id, "transaction id does not fit the cancel API")
        try session.disableAutoRenewForTransaction(identifier: identifier)
        let renewal = try await renewalInfo(productID)
        step(productID, "cancel", renewal.willAutoRenew == false, "willAutoRenew=\(renewal.willAutoRenew)")

        try session.expireSubscription(productIdentifier: productID)
        let state = try await subscriptionState(productID)
        entitled = try await entitlementIDs()
        let expired = state == .expired && !entitled.contains(productID)
        step(productID, "expiry", expired, "state=\(String(describing: state)) entitled=\(entitled.sorted().joined(separator: ","))")
        print("AUDIT_STOREKIT product=\(productID) purchase=PASS trial=PASS restore=PASS cancel=PASS expiry=PASS")
    }

    private func step(_ productID: String, _ name: String, _ ok: Bool, _ detail: String) {
        let result = ok ? "PASS" : "FAIL"
        print("AUDIT_STOREKIT product=\(productID) step=\(name) result=\(result) detail=\(detail)")
        XCTAssertTrue(ok, "\(productID) \(name) \(detail)")
    }

    private func entitlementIDs() async throws -> Set<String> {
        var ids = Set<String>()
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                ids.insert(transaction.productID)
            }
        }
        return ids
    }

    private func renewalInfo(_ productID: String) async throws -> Product.SubscriptionInfo.RenewalInfo {
        let item = try await status(productID)
        guard case .verified(let info) = item.renewalInfo else {
            XCTFail("\(productID) renewal info unverified")
            throw NSError(domain: "StoreKitLifecycle", code: 1)
        }
        return info
    }

    private func subscriptionState(_ productID: String) async throws -> Product.SubscriptionInfo.RenewalState {
        try await status(productID).state
    }

    private func status(_ productID: String) async throws -> Product.SubscriptionInfo.Status {
        let product = try XCTUnwrap(try await Product.products(for: [productID]).first)
        let statuses = try await XCTUnwrap(product.subscription).status
        return try XCTUnwrap(statuses.first, "\(productID) has no subscription status")
    }
}
