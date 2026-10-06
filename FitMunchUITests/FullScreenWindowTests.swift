import UIKit
import XCTest

/// Build 10: a real launch screen must fill the simulator, not letterbox at 320x480.
final class FullScreenWindowTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFullScreenWindow() throws {
        let slug = deviceSlug()
        let tag = shotTag()
        let app = XCUIApplication()
        app.launchArguments = [ReviewLaunchArgument.flag, "-UseLocalStoreKit", "-CaptureLaunch"]
        app.launch()

        let today = app.navigationBars["Today"].waitForExistence(timeout: 25)
            || app.staticTexts["Today"].waitForExistence(timeout: 5)
        XCTAssertTrue(today, "Today did not appear. The shot would be the home screen.")
        XCTAssertEqual(app.state, .runningForeground)

        let todayShot = try assertFullScreen(app, slug: slug, phase: "today")
        saveShot(todayShot, name: "today-\(tag)")

        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Tab bar missing before paywall")
        openUpgradePaywall(in: app)
        XCTAssertTrue(app.buttons["paywall-close"].waitForExistence(timeout: 8), "Paywall did not open")
        XCTAssertTrue(
            app.staticTexts["Eat to your goals with every shop"].waitForExistence(timeout: 8),
            "Paywall headline missing. The shot would not be the paywall."
        )
        let annual = scrollUntilHittable([
            app.buttons["paywall-plan-fitmunch_annual"],
            app.staticTexts["paywall-price-fitmunch_annual"],
        ], in: app)
        XCTAssertNotNil(annual, "Annual StoreKit plan missing. The paywall must not use a fake catalog.")
        let annualPrice = app.staticTexts["paywall-price-fitmunch_annual"]
        let annualLabel = annualPrice.exists ? annualPrice.label : (annual?.label ?? "")
        XCTAssertTrue(annualLabel.contains("149.99"), "Annual price \(annualLabel)")
        let monthly = scrollUntilHittable([
            app.staticTexts["paywall-price-fitmunch_monthly"],
            app.buttons["paywall-plan-fitmunch_monthly"],
        ], in: app)
        let monthlyPrice = app.staticTexts["paywall-price-fitmunch_monthly"]
        let monthlyLabel = monthlyPrice.exists ? monthlyPrice.label : (monthly?.label ?? "")
        XCTAssertTrue(monthlyLabel.contains("19.99"), "Monthly price \(monthlyLabel)")
        XCTAssertFalse(app.buttons["paywall-retry"].exists, "Retry state means StoreKit products did not load")
        XCTAssertFalse(app.staticTexts["Day 12 we remind you"].exists)
        XCTAssertFalse(app.staticTexts["Configuration Required"].exists, "Orange configuration card is on the paywall")
        XCTAssertFalse(app.buttons["Continue on the web"].exists)
        XCTAssertFalse(app.staticTexts["Continue on the web"].exists)
        XCTAssertNotNil(
            scrollUntilHittable([
                app.buttons["paywall-restore"],
                app.buttons["paywall-restore-inline"],
            ], in: app),
            "Restore missing on the paywall"
        )
        for _ in 0..<4 where !app.staticTexts["Eat to your goals with every shop"].isHittable {
            app.swipeDown()
        }
        XCTAssertEqual(app.state, .runningForeground)
        let paywallShot = try assertFullScreen(app, slug: slug, phase: "paywall")
        saveShot(paywallShot, name: "paywall-\(tag)")
    }

    /// App frame and the app screenshot. 6.9-inch Pro Max is 440x956. 6.5-inch 11 Pro Max is 414x896.
    /// XCUIScreen has no bounds. A letterboxed legacy app is 320x480 with black bands.
    private func assertFullScreen(_ app: XCUIApplication, slug: String, phase: String) throws -> XCUIScreenshot {
        XCTAssertEqual(app.state, .runningForeground, "Screenshot would miss the app during \(phase)")
        let frame = app.frame
        let shot = app.screenshot()
        let size = pointLabel(frame.size)
        let shotSize = pointLabel(shot.image.size)
        let expected = expectedPoints()
        let pixels = pixelLabel(expected)
        print("FULLSCREEN_SIZE \(phase) \(slug) \(size)")
        print("APP_FOREGROUND_SHOT \(phase) \(slug) frame=\(size) shot=\(shotSize)")
        XCTAssertNotEqual(size, "320x480", "App is letterboxed")
        XCTAssertEqual(size, expected, "Expected \(expected) on this simulator, got \(size)")
        XCTAssertTrue(
            shotSize == expected || shotSize == pixels,
            "App screenshot is \(shotSize), expected \(expected) points or \(pixels) pixels. Black bands or the home screen fail this."
        )
        appendSize("\(phase)\t\(slug)\t\(size)\n")
        return shot
    }

    private func shotTag() -> String {
        expectedPoints() == "414x896" ? "6.5" : "6.9"
    }

    private func pointLabel(_ size: CGSize) -> String {
        "\(Int(size.width.rounded()))x\(Int(size.height.rounded()))"
    }

    private func pixelLabel(_ points: String) -> String {
        let parts = points.split(separator: "x").compactMap { Int($0) }
        guard parts.count == 2 else { return points }
        return "\(parts[0] * 3)x\(parts[1] * 3)"
    }

    private func expectedPoints() -> String {
        let name = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? UIDevice.current.name
        if name.contains("11 Pro Max") {
            return "414x896"
        }
        return "440x956"
    }

    private func deviceSlug() -> String {
        let name = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? UIDevice.current.name
        let slug = name.lowercased().replacingOccurrences(of: " ", with: "-")
        return slug.isEmpty ? "simulator" : slug
    }

    private func screenshotDirectories() -> [URL] {
        var urls = [URL(fileURLWithPath: "/tmp/fitmunch-b10-screenshots", isDirectory: true)]
        let env = ProcessInfo.processInfo.environment
        if let shared = env["SIMULATOR_SHARED_RESOURCES_DIRECTORY"], !shared.isEmpty {
            urls.append(
                URL(fileURLWithPath: shared, isDirectory: true)
                    .appendingPathComponent("fitmunch-b10-screenshots", isDirectory: true)
            )
        }
        if let host = env["SIMULATOR_HOST_HOME"], !host.isEmpty {
            urls.append(
                URL(fileURLWithPath: host, isDirectory: true)
                    .appendingPathComponent("fitmunch-b10-screenshots", isDirectory: true)
            )
        }
        return urls
    }

    private func saveShot(_ shot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        let data = shot.pngRepresentation
        var wrote = false
        for dir in screenshotDirectories() {
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let url = dir.appendingPathComponent("\(name).png")
                try data.write(to: url)
                wrote = true
                print("FULLSCREEN_SHOT \(url.path)")
            } catch {
                print("FULLSCREEN_SHOT_FAIL \(dir.path) \(error)")
            }
        }
        XCTAssertTrue(wrote, "Could not write \(name).png")
    }

    private func appendSize(_ line: String) {
        for dir in screenshotDirectories() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("sizes.txt")
            if FileManager.default.fileExists(atPath: url.path),
               let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(Data(line.utf8))
                try? handle.close()
            } else {
                try? Data(line.utf8).write(to: url)
            }
        }
    }
}
