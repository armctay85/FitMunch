import UIKit
import XCTest

/// Build 10: a real launch screen must fill the simulator, not letterbox at 320x480.
final class FullScreenWindowTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFullScreenWindow() throws {
        let slug = deviceSlug()
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(
            app.staticTexts["Create Free Account"].waitForExistence(timeout: 25),
            "FitMunch create-account screen did not appear"
        )
        XCTAssertEqual(app.state, .runningForeground)

        _ = try assertFullScreen(app, slug: slug, phase: "first-run")
        saveShot(app, name: "first-run-\(slug)")

        app.terminate()
        app.launchArguments = [ReviewLaunchArgument.flag, "-UseLocalStoreKit"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 25), "Tab bar missing before paywall")
        openUpgradePaywall(in: app)

        let plans = app.otherElements["paywall-plans"].waitForExistence(timeout: 20)
            || app.buttons["paywall-plan-fitmunch_annual"].waitForExistence(timeout: 3)
        let retry = app.buttons["paywall-retry"].exists
            || app.buttons["paywall-retry"].waitForExistence(timeout: plans ? 1 : 15)
        XCTAssertTrue(plans || retry, "Paywall showed neither plans nor Retry")
        XCTAssertFalse(app.staticTexts["Configuration Required"].exists, "Orange configuration card is on the paywall")
        XCTAssertFalse(app.buttons["Continue on the web"].exists)
        XCTAssertFalse(app.staticTexts["Continue on the web"].exists)
        XCTAssertTrue(
            app.buttons["paywall-restore"].exists || app.buttons["paywall-restore-inline"].exists,
            "Restore missing on the paywall"
        )

        XCTAssertEqual(app.state, .runningForeground)
        _ = try assertFullScreen(app, slug: slug, phase: "paywall")
        saveShot(app, name: "paywall-\(slug)")
    }

    /// Window frame of the running app. 6.9-inch Pro Max is 440x956. 6.5-inch 11 Pro Max is 414x896.
    private func assertFullScreen(_ app: XCUIApplication, slug: String, phase: String) throws -> CGSize {
        XCTAssertEqual(app.state, .runningForeground, "Screenshot would miss the app during \(phase)")
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 25), "App window missing during \(phase)")
        let size = "\(Int(window.frame.width.rounded()))x\(Int(window.frame.height.rounded()))"
        let expected = expectedPoints()
        print("FULLSCREEN_SIZE \(phase) \(slug) \(size)")
        print("APP_FOREGROUND_SHOT \(phase) \(slug) \(size)")
        XCTAssertNotEqual(size, "320x480", "App is letterboxed")
        XCTAssertEqual(size, expected, "Expected \(expected) on this simulator, got \(size)")
        appendSize("\(phase)\t\(slug)\t\(size)\n")
        return window.frame.size
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

    private func saveShot(_ app: XCUIApplication, name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        let data = shot.pngRepresentation
        for dir in screenshotDirectories() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("\(name).png")
            try? data.write(to: url)
            print("FULLSCREEN_SHOT \(url.path)")
        }
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
