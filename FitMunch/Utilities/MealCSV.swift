import Foundation

/// RFC 4180 meal export. A leading = + - or @ is prefixed so a spreadsheet
/// does not treat the cell as a formula.
enum MealCSV {
    static let header = "Date,Meal Name,Calories,Protein (g),Carbs (g),Fats (g)"

    static func field(_ raw: String) -> String {
        var text = raw
        if let first = text.first, "=+-@".contains(first) {
            text = "'" + text
        }
        let needsQuotes = text.contains(",")
            || text.contains("\"")
            || text.contains("\n")
            || text.contains("\r")
        if needsQuotes {
            text = "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return text
    }

    static func document(rows: [[String]]) -> String {
        let lines = [header] + rows.map { $0.map(field).joined(separator: ",") }
        return lines.joined(separator: "\r\n") + "\r\n"
    }
}
