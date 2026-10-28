import Darwin
import XCTest

/// Launch to a logged meal on Today. 375pt is the iOS 26.2 SE. 440pt is the Pro Max.
/// The gate is the app signpost from the first frame to the Today row with real kcal.
/// The XCTest clock is a backstop for the whole test method, including launch.
/// Quick add is used when the calorie field is on the sheet.
final class MealLogSpeedUITests: XCTestCase {
    private let calorieEntry = 480

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchToLoggedMeal() throws {
        let testStarted = Date()
        let app = XCUIApplication()
        app.launchArguments = ["-ReviewGuards", "-ForceLightMode", "-MealLogTiming"]
        var width = 0
        var calories = -1
        var detailCalories = -1
        var mealShown = false
        var path = "unset"
        var mealName = ""
        var elapsed = 0.0
        var launchSeconds = 0.0
        var xctestSeconds = 0.0
        var signpost = ""
        let launchStarted = Date()
        app.launch()
        let ready = Date()
        launchSeconds = ready.timeIntervalSince(launchStarted)
        defer {
            emit(String(
                format: "MEAL_LOG_SECONDS %.2f MEAL_LOG_LAUNCH %.2f MEAL_LOG_XCTEST %.2f width=%d calories=%d mealShown=%@ path=%@ detailCalories=%d meal=%@",
                elapsed,
                launchSeconds,
                xctestSeconds,
                width,
                calories,
                mealShown ? "true" : "false",
                path,
                detailCalories,
                mealName
            ))
        }
        let log = app.buttons["today-log-meal"]
        XCTAssertTrue(log.waitForExistence(timeout: 20), "Today did not open after onboarding")
        log.tap()

        let name = app.textFields["meal-name"]
        let quick = app.textFields["meal-quick-calories"]
        if quick.waitForExistence(timeout: 8) {
            path = "quick"
            quick.tap()
            quick.typeText(String(calorieEntry))
        } else {
            path = "manual"
            mealName = "Snack"
            name.tap()
            name.typeText(mealName)
            dismissKeyboard(in: app)

            let manual = app.textFields["meal-manual-name"]
            XCTAssertTrue(manual.waitForExistence(timeout: 6), "Manual food field missing")
            manual.tap()
            manual.typeText("Eggs")
            dismissKeyboard(in: app)

            let add = app.buttons["meal-add-manual"]
            XCTAssertTrue(add.waitForExistence(timeout: 6))
            if !add.isHittable {
                _ = scrollUntilHittable([add], in: app)
            }
            XCTAssertTrue(add.isHittable, "Add manually is not on screen")
            add.tap()
            detailCalories = positiveIntegers(in: app).max() ?? 0
        }

        let save = app.buttons["meal-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 4), "Save missing")
        if !save.isEnabled {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(save.isEnabled, "Save stayed disabled on the \(path) path")
        if save.isHittable {
            save.tap()
        } else {
            save.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }

        XCTAssertTrue(app.buttons["today-log-meal"].waitForExistence(timeout: 8), "Meal sheet did not close")
        let shownDeadline = Date().addingTimeInterval(4)
        while Date() < shownDeadline {
            calories = loggedCalories(in: app)
            let named = app.descendants(matching: .any)["today-meal-name"]
            let nameVisible = named.exists
            if mealName.isEmpty, nameVisible, !named.label.isEmpty {
                mealName = named.label
            }
            mealShown = nameVisible && calories > 0 && !mealName.isEmpty
            if mealShown {
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
        if calories < 0 {
            calories = loggedCalories(in: app)
        }
        XCTAssertFalse(app.buttons["paywall-close"].exists, "Plus opened the paywall before a meal was logged")
        width = Int(app.windows.firstMatch.frame.width.rounded())
        elapsed = Date().timeIntervalSince(ready)
        signpost = signpostReport(in: app)
        xctestSeconds = Date().timeIntervalSince(testStarted)
        let interval = intervalSeconds(in: signpost)
        emit(String(
            format: "MEAL_LOG_SECONDS %.2f MEAL_LOG_LAUNCH %.2f MEAL_LOG_XCTEST %.2f width=%d calories=%d mealShown=%@ path=%@ detailCalories=%d meal=%@",
            elapsed,
            launchSeconds,
            xctestSeconds,
            width,
            calories,
            mealShown ? "true" : "false",
            path,
            detailCalories,
            mealName
        ))
        if !signpost.isEmpty {
            emit("MEAL_LOG_SIGNPOST \(signpost)")
        }
        if !mealShown || calories <= 0 {
            let labels = app.staticTexts.allElementsBoundByIndex.prefix(24).map(\.label)
            emit("MEAL_LOG_LABELS \(labels.joined(separator: " | "))")
        }

        XCTAssertTrue(width == 375 || width == 440, "Expected the 375pt or 440pt simulator, got \(width)")
        XCTAssertFalse(mealName.isEmpty, "Meal name was empty")
        XCTAssertTrue(mealShown, "\(mealName) did not appear on Today")
        XCTAssertGreaterThan(calories, 0, "Today showed \(mealName) with \(calories) calories on the \(path) path")
        if path == "quick" {
            XCTAssertEqual(calories, calorieEntry, "Today showed \(calories) calories after entering \(calorieEntry)")
        }
        XCTAssertNotNil(interval, "LaunchToLoggedKcal signpost was missing: \(signpost)")
        XCTAssertLessThanOrEqual(interval ?? 999, 10, String(format: "LaunchToLoggedKcal took %.3fs", interval ?? 999))
        XCTAssertLessThan(xctestSeconds, 20, String(format: "XCTest took %.2fs", xctestSeconds))
    }

    private func intervalSeconds(in report: String) -> Double? {
        guard let range = report.range(of: "interval=") else { return nil }
        var token = ""
        for character in report[range.upperBound...] {
            if character.isNumber || character == "." {
                token.append(character)
            } else {
                break
            }
        }
        return Double(token)
    }

    /// One query, after `elapsed` is captured, so the harness clock stays put.
    private func signpostReport(in app: XCUIApplication) -> String {
        let probe = app.descendants(matching: .any)["meal-log-signpost"]
        guard probe.exists else { return "" }
        return probe.label
    }

    private func emit(_ line: String) {
        fputs(line + "\n", stdout)
        fflush(stdout)
    }

    private func loggedCalories(in app: XCUIApplication) -> Int {
        let badge = app.descendants(matching: .any)["today-meal-calories"]
        if badge.exists {
            let label = badge.label.trimmingCharacters(in: .whitespacesAndNewlines)
            if let value = Int(label) {
                return value
            }
            let digits = label.prefix(while: { $0.isNumber })
            if let value = Int(digits), value > 0 {
                return value
            }
        }
        return 0
    }

    private func positiveIntegers(in app: XCUIApplication) -> [Int] {
        app.staticTexts.allElementsBoundByIndex.compactMap { element in
            let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let value = Int(label), value > 0 else { return nil }
            return value
        }
    }

    private func dismissKeyboard(in app: XCUIApplication) {
        if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        }
    }
}
