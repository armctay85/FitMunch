import Foundation

/// "1 item" or "2 items". Meal cards were hardcoding the plural.
enum MealItemCount {
    static func label(for count: Int) -> String {
        count == 1 ? "1 item" : "\(count) items"
    }
}
