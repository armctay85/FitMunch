import XCTest
@testable import FitMunch

final class ItemNormaliseTests: XCTestCase {
    func testSharedFixture() throws {
        let bundles = [Bundle(for: ItemNormaliseAnchor.self), Bundle(for: ItemNormaliseTests.self), Bundle.main]
        var data: Data?
        for bundle in bundles {
            if let url = bundle.url(forResource: "item-normalise", withExtension: "json") {
                data = try Data(contentsOf: url)
                break
            }
        }
        let payload = try XCTUnwrap(data)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any])
        let cases = try XCTUnwrap(object["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 10)
        for row in cases {
            let input = try XCTUnwrap(row["input"] as? String)
            let got = ItemNormalise.normaliseLabel(input)
            XCTAssertEqual(got.itemKey, row["itemKey"] as? String, input)
            XCTAssertEqual(got.confidence, row["confidence"] as? String, input)
            if row["packSizeValue"] is NSNull || row["packSizeValue"] == nil {
                XCTAssertNil(got.packSizeValue, input)
            } else {
                let expectedValue = try XCTUnwrap((row["packSizeValue"] as? NSNumber)?.doubleValue, input)
                XCTAssertEqual(got.packSizeValue ?? -1, expectedValue, accuracy: 0.001, input)
            }
            let expectedUnit = row["packSizeUnit"] as? String
            XCTAssertEqual(got.packSizeUnit, expectedUnit, input)
        }
    }
}
