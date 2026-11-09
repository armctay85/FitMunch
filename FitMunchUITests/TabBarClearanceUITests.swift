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
                // First frame, before any drag: this is the store shot's resting state.
                assertPlanRestsClearOfGenerate(control, in: app)
                assertMondayDinnerClearsGenerate(control, in: app)
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

    /// Resting Plan, measured before any drag or scroll. Every meal row on screen
    /// ends above Generate with its title and kcal line, or is fully hidden.
    /// The fold is the bottom of the week's scroll view (the Generate bar's top),
    /// or Generate's minY if that scroll view is not found.
    private func assertPlanRestsClearOfGenerate(_ generate: XCUIElement, in app: XCUIApplication) {
        let week = app.staticTexts["High protein training week"]
        XCTAssertTrue(week.waitForExistence(timeout: 8), "Store launch did not seed the week on Plan")
        // One frame for the fold guard to settle after the tab opens.
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let scroller = tallestPlanScroll(in: app)
        var fold = generate.frame.minY
        if scroller.exists, scroller.frame.height > 80 {
            fold = min(fold, scroller.frame.maxY)
        }
        let top = week.frame.minY
        let texts = staticTextFrames(in: app).filter { $0.frame.height > 1 && $0.frame.minY >= top - 1 }
        print("PLAN_REST fold=\(fold) generateMinY=\(generate.frame.minY) texts=\(texts.count)")

        let cut = texts.first { $0.frame.minY < fold - 1 && $0.frame.maxY > fold + 1 }
        XCTAssertNil(
            cut,
            "Plan at rest: '\(cut?.label ?? "")' \(String(describing: cut?.frame)) is cut by Generate (fold \(fold))"
        )

        let kcalLines = texts.filter { $0.label.contains("protein per serve") }
        XCTAssertFalse(kcalLines.isEmpty, "Plan at rest shows no meal rows")
        for line in kcalLines {
            let title = texts
                .filter { !$0.label.contains("protein per serve") }
                .filter { $0.frame.maxY <= line.frame.minY + 1 && $0.frame.maxY >= line.frame.minY - 12 }
                .max { $0.frame.maxY < $1.frame.maxY }
            guard let title else {
                XCTFail("Meal row kcal line '\(line.label)' at \(line.frame) has no title above it at rest")
                continue
            }
            let titleShown = title.frame.maxY <= fold + 1
            let lineShown = line.frame.maxY <= fold + 1
            XCTAssertEqual(
                titleShown,
                lineShown,
                "Plan at rest splits '\(title.label)' at Generate (title \(title.frame), kcal \(line.frame), fold \(fold))"
            )
        }

        let shown = kcalLines.filter { $0.frame.maxY <= fold + 1 }
        XCTAssertFalse(shown.isEmpty, "No whole meal row above Generate at rest")
        if let last = shown.max(by: { $0.frame.maxY < $1.frame.maxY }) {
            print("PLAN_REST lastRow kcalMaxY=\(last.frame.maxY) fold=\(fold)")
            XCTAssertLessThanOrEqual(
                last.frame.maxY,
                generate.frame.minY,
                "Last meal row at rest ends under Generate (kcal \(last.frame), button \(generate.frame))"
            )
        }
    }

    /// One accessibility snapshot, so the rest check reads every frame from the same moment.
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

    /// Monday dinner is the row above Generate. Its frame has to end on or above the button.
    /// The plan is generated first. An empty Plan has no Monday row to measure.
    private func assertMondayDinnerClearsGenerate(_ generate: XCUIElement, in app: XCUIApplication) {
        generatePlanIfNeeded(generate, in: app)
        print("PLAN_AX_DUMP_BEGIN")
        print(app.debugDescription)
        print("PLAN_AX_DUMP_END")
        let dinner = app.staticTexts["plan-monday-dinner"]
        let scroller = tallestPlanScroll(in: app)
        var nudges = 0
        while nudges < 8 && !mondayDinnerClears(dinner, generate: generate) {
            let tooHigh = dinner.exists && dinner.frame.height > 8 && dinner.frame.midY < 160
            dragPlan(scroller.exists ? scroller : app, revealLower: !tooHigh)
            nudges += 1
        }
        XCTAssertTrue(dinner.waitForExistence(timeout: 8), "Monday dinner missing")
        XCTAssertGreaterThan(dinner.frame.height, 8, "Monday dinner has no frame \(dinner.frame)")
        XCTAssertLessThanOrEqual(
            dinner.frame.maxY,
            generate.frame.minY,
            "Monday dinner ends under Generate (dinner \(dinner.frame), button \(generate.frame))"
        )
    }

    /// Store shots stay at the top of the week, so Monday dinner starts below
    /// the fold. Nudge it into the band above Generate before measuring.
    private func mondayDinnerClears(_ dinner: XCUIElement, generate: XCUIElement) -> Bool {
        guard dinner.exists else { return false }
        let frame = dinner.frame
        guard frame.height > 8, frame.minY >= 0 else { return false }
        return frame.maxY <= generate.frame.minY
    }

    private func tallestPlanScroll(in app: XCUIApplication) -> XCUIElement {
        let scrolls = app.scrollViews.allElementsBoundByIndex.filter { $0.frame.height > 80 }
        return scrolls.max(by: { $0.frame.height < $1.frame.height }) ?? app.scrollViews.firstMatch
    }

    /// revealLower moves the finger up so rows below the fold come into view.
    private func dragPlan(_ element: XCUIElement, revealLower: Bool) {
        let startY: CGFloat = revealLower ? 0.70 : 0.40
        let endY: CGFloat = revealLower ? 0.46 : 0.64
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    /// Screenshot launch fills a week on appear. If that row is not up yet, tap the
    /// plan action so Monday exists before the clearance check looks for it.
    private func generatePlanIfNeeded(_ generate: XCUIElement, in app: XCUIApplication) {
        let week = app.staticTexts["High protein training week"]
        if week.waitForExistence(timeout: 4) { return }
        let build = app.buttons["plan-build-week"]
        if build.waitForExistence(timeout: 2) {
            if !build.isHittable {
                _ = scrollUntilHittable([build], in: app)
            }
            if build.isHittable {
                build.tap()
            }
        } else if generate.isHittable {
            generate.tap()
        }
        _ = week.waitForExistence(timeout: 8)
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
