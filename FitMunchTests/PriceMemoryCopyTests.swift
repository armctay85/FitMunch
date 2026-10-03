import XCTest
@testable import FitMunch

final class PriceMemoryCopyTests: XCTestCase {
    private var now: Date {
        var parts = DateComponents()
        parts.year = 2026
        parts.month = 10
        parts.day = 3
        return Calendar.current.date(from: parts) ?? Date()
    }

    func testAllowedLinesAndVoiceOver() {
        let memo = PriceMemoryCopy.Memo(
            lastPaid: .init(cents: 1100, storeName: "Coles", purchasedOn: "2026-09-12")
        )
        XCTAssertEqual(
            PriceMemoryCopy.lastPaidLine(memo, now: now),
            "Your last paid: A$11.00 at Coles (12 Sep)"
        )
        XCTAssertEqual(
            PriceMemoryCopy.voiceOver(memo, now: now),
            "You last paid 11 dollars at Coles on 12 September"
        )
        let ranged = PriceMemoryCopy.Memo(
            lastPaid: memo.lastPaid,
            range: .init(minCents: 1050, maxCents: 1250, receipts: 4, since: "2026-04-02")
        )
        XCTAssertEqual(
            PriceMemoryCopy.rangeLine(ranged, now: now),
            "You paid A$10.50 to A$12.50 (4 receipts since Apr)"
        )
        XCTAssertEqual(PriceMemoryCopy.shortDate("2025-09-12", now: now), "12 Sep 2025")
        XCTAssertEqual(PriceMemoryCopy.footnote, "From your receipts. Shelf prices change. Check at checkout.")
    }

    func testBannedPhrasesAreAbsent() {
        let memo = PriceMemoryCopy.Memo(
            lastPaid: .init(
                cents: 1100,
                storeName: "Aldi",
                purchasedOn: "2026-07-03",
                showUnitRate: true,
                unitRateCents: 1100,
                unitRateBasis: "per_kg"
            ),
            ageBand: "older"
        )
        let line = PriceMemoryCopy.lastPaidLine(memo, now: now)
        XCTAssertEqual(line, "Your last paid: A$11.00/kg at Aldi (3 Jul) · older than 3 months")
        let banned = ["current price", "catalogue", "cheapest", "average price", "~$"]
        for phrase in banned {
            XCTAssertFalse(line.lowercased().contains(phrase))
        }
    }
}
