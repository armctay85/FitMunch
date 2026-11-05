import XCTest
@testable import FitMunch

final class MealItemCountTests: XCTestCase {
    func testOneItemIsSingular() {
        XCTAssertEqual(MealItemCount.label(for: 1), "1 item")
    }

    func testOtherCountsStayPlural() {
        XCTAssertEqual(MealItemCount.label(for: 0), "No items")
        XCTAssertEqual(MealItemCount.label(for: 2), "2 items")
    }
}
