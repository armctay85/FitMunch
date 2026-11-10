import XCTest

/// Lowest primary control on each tab must be on screen and hittable.
/// The design job runs this on 6.9 (440x956) and 6.5 (414x896).
final class TabBarClearanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLowestPrimaryControlIsHittable() throws {
        let app = XCUIApplication()
        app.launchArguments = [ScreenshotLaunchArgument.flag, "-ForceLightMode"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25))

        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 8))
        let width = window.frame.width
        let height = window.frame.height
        let is69 = abs(width - 440) < 3 && abs(height - 956) < 3
        let is65 = abs(width - 414) < 3 && abs(height - 896) < 3
        XCTAssertTrue(
            is69 || is65,
            "Expected 6.9 (440x956) or 6.5 (414x896). Window is \(width)x\(height)"
        )
        logTodayMealCards(in: app, screenHeight: height)

        let controls: [(tab: String, identifier: String, type: XCUIElement.ElementType)] = [
            ("Today", "today-log-meal", .button),
            ("Plan", "plan-generate", .button),
            ("Scan", "scan-take-photo", .button),
            ("Coach", "coach-input", .textField),
            ("Me", "me-dark-mode", XCUIElement.ElementType.switch),
        ]

        for item in controls {
            openTab(item.tab, in: app)
            if item.identifier == "scan-take-photo" {
                revealScanPhoto(in: app)
            }
            let control = app.descendants(matching: item.type)[item.identifier]
            XCTAssertTrue(
                control.waitForExistence(timeout: 15),
                "\(item.identifier) \(item.type) missing on \(item.tab)"
            )
            if item.identifier == "plan-generate" {
                XCTAssertTrue(
                    control.isHittable,
                    "plan-generate is not hittable (\(Int(width.rounded()))x\(Int(height.rounded())))"
                )
            } else {
                let becameHittable = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "isHittable == true"),
                    object: control
                )
                if XCTWaiter.wait(for: [becameHittable], timeout: 6) != .completed {
                    _ = scrollUntilHittable([control], in: app)
                }
                XCTAssertTrue(
                    control.isHittable,
                    "\(item.identifier) is not hittable on \(item.tab) (\(Int(width.rounded()))x\(Int(height.rounded())))"
                )
            }
            let barTop = tabButtonTop(in: app)
            XCTAssertLessThanOrEqual(
                control.frame.maxY,
                barTop - 4,
                "\(item.identifier) sits under the tab bar (control \(control.frame), tab buttons top \(barTop))"
            )
            if item.identifier == "plan-generate" {
                assertPlanRestsClearOfGenerate(control, in: app)
            }
        }
    }

    /// Resting Today cards. 6.5 is the short phone; the log is the card bottom the layout produced.
    private func logTodayMealCards(in app: XCUIApplication, screenHeight: CGFloat) {
        let cards = app.descendants(matching: .any)
            .matching(identifier: "today-meal-card")
            .allElementsBoundByIndex
            .filter { $0.frame.width > 80 && $0.frame.height > 40 }
            .sorted { $0.frame.minY < $1.frame.minY }
        print("MEAL_CARDS place=clearance screen=\(Int(screenHeight.rounded()))")
        for card in cards {
            let name = card.staticTexts["today-meal-name"]
            let title = name.exists ? name.label : card.label
            let frame = card.frame
            print("MEAL_CARD name=\(title) minY=\(frame.minY) height=\(frame.height) maxY=\(frame.maxY)")
        }
        let summary = app.descendants(matching: .any)["daily-summary-title"]
        if summary.waitForExistence(timeout: 4) {
            print("SUMMARY_HEIGHT \(summary.value ?? "") \(summary.label)")
        }
    }

    /// Resting Plan, before any drag. The lowest meal line ends at least 8pt above the Generate fold.
    private func assertPlanRestsClearOfGenerate(_ generate: XCUIElement, in app: XCUIApplication) {
        let week = app.staticTexts["High protein training week"]
        XCTAssertTrue(week.waitForExistence(timeout: 8), "Store launch did not seed the week on Plan")
        let fold = planFold(generate: generate, in: app)
        let top = week.frame.minY
        let texts = staticTextFrames(in: app).filter { row in
            row.frame.height > 8 && row.frame.minY >= top - 1 && row.frame.minY < fold
        }
        let limit = fold - 8
        print("PLAN_REST fold=\(fold) generateMinY=\(generate.frame.minY) limit=\(limit) texts=\(texts.count)")
        let cut = texts.first { $0.frame.maxY > limit + 0.5 }
        XCTAssertNil(
            cut,
            "Plan at rest: '\(cut?.label ?? "")' \(String(describing: cut?.frame)) ends below the Generate fold minus 8pt (fold \(fold), limit \(limit))"
        )
        let meals = texts.filter { $0.label.contains("protein per serve") }
        XCTAssertFalse(meals.isEmpty, "Plan at rest shows no whole meal row above Generate")
        if let last = meals.max(by: { $0.frame.maxY < $1.frame.maxY }) {
            print("PLAN_REST lastRow='\(last.label)' maxY=\(last.frame.maxY) limit=\(limit)")
            XCTAssertLessThanOrEqual(
                last.frame.maxY,
                limit + 0.5,
                "Last meal row at rest is under the Generate fold (row \(last.frame), fold \(fold))"
            )
        }
    }

    /// Top edge of the Generate bar. This is the clip, not the green button under the padding.
    private func planFold(generate: XCUIElement, in app: XCUIApplication) -> CGFloat {
        let marked = app.descendants(matching: .any)["plan-fold"]
        XCTAssertTrue(marked.waitForExistence(timeout: 4), "plan-fold missing above Generate")
        XCTAssertGreaterThan(marked.frame.minY, 40, "plan-fold has no frame \(marked.frame)")
        XCTAssertLessThan(marked.frame.minY, generate.frame.minY, "plan-fold is not above Generate \(generate.frame)")
        return marked.frame.minY
    }

    private func staticTextFrames(in app: XCUIApplication) -> [(label: String, frame: CGRect)] {
        guard let root = try? app.snapshot() else { return [] }
        var found: [(label: String, frame: CGRect)] = []
        func walk(_ node: XCUIElementSnapshot) {
            if node.elementType == .staticText {
                found.append((label: node.label, frame: node.frame))
            }
            for child in node.children {
                walk(child)
            }
        }
        walk(root)
        return found
    }

    /// Screenshot launch already allows AI data. A full-app swipe on the short
    /// phone can leave Scan, so this only nudges the scan scroll view.
    private func revealScanPhoto(in app: XCUIApplication) {
        if scanPhoto(in: app).waitForExistence(timeout: 12) { return }
        let allow = app.buttons["ai-consent-allow"]
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
        }
        if scanPhoto(in: app).exists { return }
        openTab("Scan", in: app)
        let scroller = app.scrollViews.firstMatch
        var hops = 0
        while !scanPhoto(in: app).exists && hops < 3 {
            if scroller.exists {
                scroller.swipeUp()
            }
            hops += 1
        }
        if !scanPhoto(in: app).exists {
            let labels = app.staticTexts.allElementsBoundByIndex.prefix(8).map(\.label)
            print("SCAN_MISSING labels=\(labels.joined(separator: " | "))")
        }
    }

    private func scanPhoto(in app: XCUIApplication) -> XCUIElement {
        let identified = app.buttons["scan-take-photo"]
        if identified.exists { return identified }
        return app.buttons["Take a photo"]
    }

    private func tabButtonTop(in app: XCUIApplication) -> CGFloat {
        let bar = app.tabBars.firstMatch
        var top = bar.frame.minY
        for name in ["Today", "Plan", "Scan", "Coach", "Me"] {
            let button = bar.buttons[name]
            if button.exists, button.frame.height > 1 {
                top = min(top, button.frame.minY)
            }
        }
        return top
    }
}
