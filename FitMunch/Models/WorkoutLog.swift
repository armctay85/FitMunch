import Foundation
import SwiftData

/// A single logged exercise set — parity with the web `exercise_tracker.js`.
@Model
final class WorkoutLog {
    var id: UUID
    var name: String
    var sets: Int
    var reps: String
    var weight: Double
    var date: Date
    var notes: String

    init(
        id: UUID = UUID(),
        name: String,
        sets: Int,
        reps: String,
        weight: Double = 0,
        date: Date = Date(),
        notes: String = ""
    ) {
        self.id = id
        self.name = name
        self.sets = sets
        self.reps = reps
        self.weight = weight
        self.date = date
        self.notes = notes
    }

    /// Estimated volume load (sets × reps × weight) where reps parses as a number, else 0.
    var volumeLoad: Double {
        let repCount = Double(reps.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) ?? 0
        return Double(sets) * repCount * weight
    }
}
