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

        let loaded = try await Product.products(for: [productID])
        let product = try XCTUnwrap(loaded.first)
        let subscription = try XCTUnwrap(product.subscription, "\(productID) subscription")
        let intro = try XCTUnwrap(subscription.introductoryOffer, "\(productID) intro")
        step(productID, "trial-offer", intro.paymentMode == .freeTrial && intro.period.unit == .day && intro.period.value == 14,
             "mode=\(intro.paymentMode) unit=\(intro.period.unit) value=\(intro.period.value)")
        let eligible = await subscription.isEligibleForIntroOffer
        step(productID, "trial-eligible", eligible, "eligible=\(eligible)")

        // One renewal every two seconds so a later wait can pass a short period.
        // The 14-day trial is still longer than that window. expireSubscription is
        // the immediate expiry. RevenueCat records that call as unreliable, so the
        // test also polls status and prints the expiration date.
        session.timeRate = .oneRenewalEveryTwoSeconds
        let transaction = try await session.buyProduct(identifier: productID)
        await transaction.finish()
        let purchased = transaction.productID == productID
        step(productID, "display-price", !product.displayPrice.isEmpty,
             "display=\(product.displayPrice) currency=\(product.priceFormatStyle.currencyCode)")
        step(productID, "purchase", purchased, "id=\(transaction.id) product=\(transaction.productID) offer=\(String(describing: transaction.offerType))")
        step(productID, "trial", transaction.offerType == .introductory, "offerType=\(String(describing: transaction.offerType))")

        var entitled = try await entitlementIDs()
        step(productID, "purchase-entitlement", entitled.contains(productID), "entitled=\(entitled.sorted().joined(separator: ","))")

        // Restore is the finished transaction still present in current entitlements
        // and Transaction.latest. AppStore.sync() never returns in this simulator
        // session (no Apple ID sheet), and a blocked sync keeps the test process
        // alive until the job is cancelled.
        let latest = await Transaction.latest(for: productID)
        let latestID: String
        if case .verified(let verified)? = latest {
            latestID = verified.productID
        } else {
            latestID = "missing"
        }
        entitled = try await entitlementIDs()
        step(productID, "restore", entitled.contains(productID) && latestID == productID,
             "latest=\(latestID) entitled=\(entitled.sorted().joined(separator: ","))")

        let ids = await transactionIDs(for: productID)
        let targets = ids.isEmpty ? [UInt(transaction.id)] : ids
        for identifier in targets {
            try session.disableAutoRenewForTransaction(identifier: identifier)
        }
        var cancelOK = false
        var cancelDetail = "ids=\(targets)"
        for _ in 0..<8 {
            if let renewal = try? await renewalInfo(productID), renewal.willAutoRenew == false {
                cancelOK = true
                cancelDetail = "willAutoRenew=false ids=\(targets)"
                break
            }
            try await Task.sleep(nanoseconds: 400_000_000)
        }
        if !cancelOK, let renewal = try? await renewalInfo(productID) {
            cancelDetail = "willAutoRenew=\(renewal.willAutoRenew) ids=\(targets) after_poll"
        }
        step(productID, "cancel", cancelOK, cancelDetail)

        let before = await latestSummary(productID)
        try session.expireSubscription(productIdentifier: productID)
        var expired = false
        var expiryDetail = "before=\(before)"
        for _ in 0..<10 {
            let state = try? await subscriptionState(productID)
            let entitledNow = (try? await entitlementIDs()) ?? []
            let summary = await latestSummary(productID)
            let gone = !entitledNow.contains(productID)
            expired = state == .expired && gone
            expiryDetail = "state=\(String(describing: state)) entitled=\(entitledNow.sorted().joined(separator: ",")) latest=\(summary)"
            if expired { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        if !expired {
            try await Task.sleep(nanoseconds: 6_000_000_000)
            let state = try? await subscriptionState(productID)
            let entitledNow = (try? await entitlementIDs()) ?? []
            let summary = await latestSummary(productID)
            expired = state == .expired && !entitledNow.contains(productID)
            expiryDetail = "after_time_rate state=\(String(describing: state)) entitled=\(entitledNow.sorted().joined(separator: ",")) latest=\(summary) before=\(before)"
        }
        step(productID, "expiry", expired, expiryDetail)
    }

    private func transactionIDs(for productID: String) async -> [UInt] {
        var ids: [UInt] = []
        for await result in Transaction.all {
            guard case .verified(let transaction) = result, transaction.productID == productID else { continue }
            ids.append(UInt(transaction.id))
        }
        return ids
    }

    private func latestSummary(_ productID: String) async -> String {
        guard let latest = await Transaction.latest(for: productID) else { return "missing" }
        guard case .verified(let transaction) = latest else { return "unverified" }
        let expiration = transaction.expirationDate.map { String(describing: $0) } ?? "nil"
        return "id=\(transaction.id) exp=\(expiration)"
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
        let loaded = try await Product.products(for: [productID])
        let product = try XCTUnwrap(loaded.first)
        let subscription = try XCTUnwrap(product.subscription)
        let statuses = try await subscription.status
        return try XCTUnwrap(statuses.first, "\(productID) has no subscription status")
    }
}
