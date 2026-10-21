import XCTest
@testable import FitMunch

final class WorkoutDurationTests: XCTestCase {
    func testRepsAndRestDeriveMinutes() {
        let exercise = WorkoutExercise(name: "Squat", sets: 3, reps: "10", rest: "60s")
        XCTAssertEqual(WorkoutDuration.minutes(for: [exercise]), 4)
    }

    func testDistanceCannotBeDerived() {
        let sled = WorkoutExercise(name: "Sled", sets: 5, time: "20m", rest: "90s")
        XCTAssertNil(WorkoutDuration.minutes(for: [sled]))
    }

    func testBeginnerPlanIsNotTheOneMinutePlaceholder() {
        let days = WorkoutPlanGenerator.plan(type: "gym", level: "Beginner")
        XCTAssertFalse(days.isEmpty)
        var derived = 0
        for day in days {
            guard let minutes = WorkoutDuration.minutes(for: day.exercises) else { continue }
            derived += 1
            XCTAssertGreaterThan(minutes, 1, day.workout)
        }
        XCTAssertGreaterThan(derived, 0)
    }
}
