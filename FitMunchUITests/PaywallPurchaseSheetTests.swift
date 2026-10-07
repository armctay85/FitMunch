import XCTest

/// StoreKit confirmation beside the running app. That session fails with
/// SKInternalErrorDomain Code=3, so these checks are skipped. Do not fake a sheet.
final class PaywallPurchaseSheetTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOpensRevenueCatPurchaseSheet() throws {
        throw XCTSkip("RevenueCat purchase sheet is not used. \(StoreKitBesideApp.skipReason)")
    }

    func testStoreKitConfirmationSheet() throws {
        print(StoreKitBesideApp.skipReason)
        throw XCTSkip(StoreKitBesideApp.skipReason)
    }
}
