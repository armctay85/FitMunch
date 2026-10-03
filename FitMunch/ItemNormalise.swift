import Foundation

/// Label to item key. Same fixture as test/fixtures/item-normalise.json.
enum ItemNormalise {
    struct Result {
        let itemKey: String
        let packSizeValue: Double?
        let packSizeUnit: String?
        let confidence: String
    }

    private struct Pack {
        var value: Double?
        var unit: String?
        var weighed: String?
    }

    static func normaliseLabel(_ raw: String) -> Result {
        let pack = parsePackValue(raw)
        let cleaned = clean(raw)
        if let key = keyword(in: cleaned) {
            return Result(itemKey: key, packSizeValue: pack.value, packSizeUnit: pack.unit, confidence: "high")
        }
        let stem = slug(labelWithoutPack(cleaned))
        return Result(
            itemKey: "other:\(stem.isEmpty ? "item" : stem)",
            packSizeValue: pack.value,
            packSizeUnit: pack.unit,
            confidence: "low"
        )
    }

    static func keyFromSku(_ sku: String) -> String {
        normaliseLabel(sku.replacingOccurrences(of: "-", with: " ")).itemKey
    }

    static func parsePack(_ raw: String) -> (packSizeValue: Double?, packSizeUnit: String?, weighed: String?) {
        let pack = parsePackValue(raw)
        return (pack.value, pack.unit, pack.weighed)
    }

    private static func parsePackValue(_ raw: String) -> Pack {
        let text = raw.lowercased()
        if text.range(of: #"\bper\s*kg\b"#, options: .regularExpression) != nil {
            return Pack(value: nil, unit: nil, weighed: "per_kg")
        }
        if let groups = match(#"(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(g|ml)\b"#, in: text), groups.count >= 4 {
            let left = Double(groups[1]) ?? 0
            let right = Double(groups[2]) ?? 0
            return Pack(value: round3(left * right), unit: groups[3], weighed: nil)
        }
        if let groups = match(#"(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b"#, in: text), groups.count >= 3 {
            let n = Double(groups[1]) ?? 0
            switch groups[2] {
            case "kg": return Pack(value: round3(n * 1000), unit: "g", weighed: nil)
            case "l": return Pack(value: round3(n * 1000), unit: "ml", weighed: nil)
            default: return Pack(value: round3(n), unit: groups[2], weighed: nil)
            }
        }
        if let groups = match(#"(\d+)\s*(pk|pack)\b"#, in: text), groups.count >= 2 {
            return Pack(value: Double(groups[1]), unit: "each", weighed: nil)
        }
        if let groups = match(#"\bx\s*(\d+)\b"#, in: text), groups.count >= 2 {
            return Pack(value: Double(groups[1]), unit: "each", weighed: nil)
        }
        return Pack(value: nil, unit: nil, weighed: nil)
    }

    private static let keywords: [(String, String)] = loadKeywords()

    private static func loadKeywords() -> [(String, String)] {
        let bundles = [Bundle(for: ItemNormaliseAnchor.self), Bundle.main]
        for bundle in bundles {
            guard let url = bundle.url(forResource: "item-normalise", withExtension: "json"),
                  let data = try? Data(contentsOf: url),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rows = object["keywords"] as? [[Any]] else { continue }
            let pairs: [(String, String)] = rows.compactMap { row in
                guard row.count >= 2, let phrase = row[0] as? String, let key = row[1] as? String else { return nil }
                return (phrase.lowercased(), key)
            }
            return pairs.sorted { $0.0.count > $1.0.count }
        }
        return []
    }

    private static func keyword(in cleaned: String) -> String? {
        for (phrase, key) in keywords where hasPhrase(cleaned, phrase) {
            return key
        }
        return nil
    }

    private static func hasPhrase(_ hay: String, _ phrase: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: phrase)
        return hay.range(of: "(^|[^a-z])\(escaped)([^a-z]|$)", options: .regularExpression) != nil
    }

    private static func clean(_ raw: String) -> String {
        var text = raw.lowercased()
        text = text.replacingOccurrences(of: #"[\*@]"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\b\d{4,8}\b"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\b(ww|woolworths|coles|macro|remano)\b"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func labelWithoutPack(_ raw: String) -> String {
        var text = raw
        let patterns = [
            #"\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(g|ml)\b"#,
            #"\d+(?:\.\d+)?\s*(kg|g|ml|l)\b"#,
            #"\d+\s*(pk|pack)\b"#,
            #"\bx\s*\d+\b"#,
            #"\bper\s*kg\b"#,
            #"\bea\b"#,
            #"\beach\b"#,
        ]
        for pattern in patterns {
            text = text.replacingOccurrences(of: pattern, with: " ", options: .regularExpression)
        }
        return text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func slug(_ value: String) -> String {
        let lowered = value.lowercased()
        let mapped = lowered.replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        return String(mapped.trimmingCharacters(in: CharacterSet(charactersIn: "-")).prefix(60))
    }

    private static func round3(_ n: Double) -> Double {
        (n * 1000).rounded() / 1000
    }

    private static func match(_ pattern: String, in text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let found = regex.firstMatch(in: text, range: range) else { return nil }
        return (0..<found.numberOfRanges).map { index in
            let part = found.range(at: index)
            guard let swiftRange = Range(part, in: text) else { return "" }
            return String(text[swiftRange])
        }
    }
}

final class ItemNormaliseAnchor: NSObject {}
