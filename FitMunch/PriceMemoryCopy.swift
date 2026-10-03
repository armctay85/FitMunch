import Foundation

/// Own-receipt price lines. Mirrors lib/price-memory-copy.js.
enum PriceMemoryCopy {
    static let footnote = "From your receipts. Shelf prices change. Check at checkout."
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    struct LastPaid {
        var cents: Int
        var storeName: String
        var purchasedOn: String
        var showUnitRate: Bool = false
        var unitRateCents: Int? = nil
        var unitRateBasis: String? = nil
        var packQualifier: Bool = false
        var packLabel: String? = nil
        var promo: Bool = false
    }

    struct RangeMemo {
        var minCents: Int
        var maxCents: Int
        var receipts: Int
        var since: String
    }

    struct Memo {
        var lastPaid: LastPaid
        var range: RangeMemo? = nil
        var ageBand: String = "recent"
    }

    static func money(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let absValue = abs(cents)
        return "A$\(sign)\(absValue / 100).\(String(format: "%02d", absValue % 100))"
    }

    static func shortDate(_ iso: String, now: Date = Date()) -> String {
        guard let parts = dateParts(iso) else { return "" }
        let month = months[parts.month - 1]
        if parts.year == Calendar.current.component(.year, from: now) {
            return "\(parts.day) \(month)"
        }
        return "\(parts.day) \(month) \(parts.year)"
    }

    static func lastPaidLine(_ memo: Memo, now: Date = Date()) -> String {
        var line = "Your last paid: \(figure(memo.lastPaid)) at \(memo.lastPaid.storeName) (\(shortDate(memo.lastPaid.purchasedOn, now: now)))"
        if memo.ageBand == "older" { line += " · older than 3 months" }
        if memo.lastPaid.promo { line += " (on special when you bought it)" }
        return line
    }

    static func rangeLine(_ memo: Memo, now: Date = Date()) -> String {
        guard let range = memo.range else { return "" }
        let noun = range.receipts == 1 ? "receipt" : "receipts"
        return "You paid \(money(range.minCents)) to \(money(range.maxCents)) (\(range.receipts) \(noun) since \(sinceLabel(range.since, now: now)))"
    }

    static func voiceOver(_ memo: Memo, now: Date = Date()) -> String {
        let last = memo.lastPaid
        let cents = last.showUnitRate ? (last.unitRateCents ?? last.cents) : last.cents
        var amount = voiceMoney(cents)
        if last.showUnitRate && last.unitRateBasis == "per_kg" { amount += " per kilogram" }
        else if last.showUnitRate && last.unitRateBasis == "per_l" { amount += " per litre" }
        return "You last paid \(amount) at \(last.storeName) on \(voiceDate(last.purchasedOn, now: now))"
    }

    private static func figure(_ last: LastPaid) -> String {
        if last.showUnitRate, let rate = last.unitRateCents {
            let suffix = last.unitRateBasis == "per_kg" ? "/kg" : last.unitRateBasis == "per_l" ? "/L" : ""
            return money(rate) + suffix
        }
        if last.packQualifier, let pack = last.packLabel {
            return "\(money(last.cents)) for \(pack)"
        }
        return money(last.cents)
    }

    private static func sinceLabel(_ iso: String, now: Date) -> String {
        guard let parts = dateParts(iso) else { return "" }
        let month = months[parts.month - 1]
        if parts.year == Calendar.current.component(.year, from: now) { return month }
        return "\(month) \(parts.year)"
    }

    private static func voiceMoney(_ cents: Int) -> String {
        let absValue = abs(cents)
        let dollars = absValue / 100
        let rem = absValue % 100
        if rem == 0 { return "\(dollars) dollars" }
        return "\(dollars) dollars and \(rem) cents"
    }

    private static func voiceDate(_ iso: String, now: Date) -> String {
        guard let parts = dateParts(iso) else { return "" }
        let month = monthsLong[parts.month - 1]
        if parts.year == Calendar.current.component(.year, from: now) { return "\(parts.day) \(month)" }
        return "\(parts.day) \(month) \(parts.year)"
    }

    private static func dateParts(_ iso: String) -> (year: Int, month: Int, day: Int)? {
        let bits = iso.prefix(10).split(separator: "-")
        guard bits.count == 3, let year = Int(bits[0]), let month = Int(bits[1]), let day = Int(bits[2]), (1...12).contains(month) else {
            return nil
        }
        return (year, month, day)
    }
}
