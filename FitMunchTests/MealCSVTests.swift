import XCTest
@testable import FitMunch

final class MealCSVTests: XCTestCase {
    func testQuotesCommasAndInnerQuotes() {
        let csv = MealCSV.document(rows: [["1 Jan", "Oats, \"plain\"", "100", "10", "12", "3"]])
        XCTAssertTrue(csv.contains("\"Oats, \"\"plain\"\"\""))
        XCTAssertTrue(csv.contains("\r\n"))
        XCTAssertTrue(csv.hasPrefix(MealCSV.header))
    }

    func testNeutralisesFormulaLeaders() {
        for leader in ["=", "+", "-", "@"] {
            let field = MealCSV.field(leader + "cmd")
            XCTAssertTrue(field.hasPrefix("'"), field)
            XCTAssertFalse(field.hasPrefix(leader), field)
        }
    }
}
