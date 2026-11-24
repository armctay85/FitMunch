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

    func testPlanFollowsGoalTargetsAndPlace() {
        let loss = WorkoutPlanGenerator.plan(type: "gym", level: "Intermediate", goal: "lose_weight", calories: 1600, protein: 120)
        let build = WorkoutPlanGenerator.plan(type: "gym", level: "Intermediate", goal: "muscle_gain", calories: 2800, protein: 180)
        let home = WorkoutPlanGenerator.plan(type: "home", level: "Intermediate", goal: "lose_weight", calories: 1600, protein: 120)
        XCTAssertFalse(loss.isEmpty)
        XCTAssertNotEqual(loss.first?.exercises.first?.rest, build.first?.exercises.first?.rest)
        XCTAssertNotEqual(loss.first?.exercises.first?.sets, build.first?.exercises.first?.sets)
        XCTAssertNotEqual(home.first?.exercises.first?.name, loss.first?.exercises.first?.name)
        for day in loss + build + home {
            for exercise in day.exercises {
                XCTAssertGreaterThan(exercise.sets, 0)
                XCTAssertTrue(exercise.reps != nil || exercise.time != nil)
                XCTAssertFalse(exercise.rest.isEmpty)
            }
        }
    }
}
