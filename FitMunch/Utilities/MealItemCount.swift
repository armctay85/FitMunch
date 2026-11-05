import Foundation

/// Plural for a meal's food count. Zero is "No items", one is "1 item".
enum MealItemCount {
    static func label(for count: Int) -> String {
        switch count {
        case 0:
            return "No items"
        case 1:
            return "1 item"
        default:
            return "\(count) items"
        }
    }
}
