import XCTest
@testable import FitMunch

final class MealTimeNameTests: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)

    func testSlotsFollowTheClock() {
        XCTAssertEqual(name(hour: 4), "Snack")
        XCTAssertEqual(name(hour: 5), "Breakfast")
        XCTAssertEqual(name(hour: 10), "Breakfast")
        XCTAssertEqual(name(hour: 11), "Lunch")
        XCTAssertEqual(name(hour: 15), "Lunch")
        XCTAssertEqual(name(hour: 16), "Dinner")
        XCTAssertEqual(name(hour: 20), "Dinner")
        XCTAssertEqual(name(hour: 21), "Snack")
        XCTAssertEqual(name(hour: 0), "Snack")
    }

    private func name(hour: Int) -> String {
        var parts = DateComponents()
        parts.calendar = calendar
        parts.year = 2026
        parts.month = 10
        parts.day = 27
        parts.hour = hour
        let date = calendar.date(from: parts)!
        return MealTimeName.name(for: date, calendar: calendar)
    }
}
