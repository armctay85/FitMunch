import Foundation

/// Breakfast, lunch, dinner, or snack from the clock. Not a food lookup.
enum MealTimeName {
    static func name(for date: Date, calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: date)
        switch hour {
        case 5..<11:
            return "Breakfast"
        case 11..<16:
            return "Lunch"
        case 16..<21:
            return "Dinner"
        default:
            return "Snack"
        }
    }
}
