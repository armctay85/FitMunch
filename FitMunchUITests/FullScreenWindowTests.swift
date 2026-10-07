import UIKit
import XCTest

/// Build 10: a real launch screen must fill the simulator, not letterbox at 320x480.
final class FullScreenWindowTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// AUD 19.99 / 149.99 on this simulator. Skipped: the unsigned runner stays on USD.
    func testSandboxStorefrontPrices() throws {
        print(StoreKitBesideApp.skipReason)
        throw XCTSkip(StoreKitBesideApp.skipReason)
    }

    func testFullScreenWindow() throws {
        let slug = deviceSlug()
        let tag = shotTag()
        let app = XCUIApplication()
        // Sandbox storefront, not a local StoreKit configuration.
        // -CaptureLaunch holds the launch screen so CI can grab that frame.
        app.launchArguments = [ReviewLaunchArgument.flag, "-CaptureLaunch"]
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
        let annualLabel = waitForPriceLabel(app, id: "fitmunch_annual", timeout: 50)
        let monthlyLabel = waitForPriceLabel(app, id: "fitmunch_monthly", timeout: 8)
        XCTAssertFalse(annualLabel.isEmpty, "Annual sandbox plan missing. The paywall must not use a fake catalog.")
        XCTAssertTrue(annualLabel.contains("/year"), "Annual price is missing the period. \(annualLabel)")
        XCTAssertTrue(monthlyLabel.contains("/month"), "Monthly price is missing the period. \(monthlyLabel)")
        print("SANDBOX_PRICE annual=\(annualLabel) monthly=\(monthlyLabel)")
        _ = scrollUntilHittable([
            app.staticTexts["paywall-price-fitmunch_annual"],
            app.staticTexts["paywall-price-fitmunch_monthly"],
        ], in: app)
        XCTAssertFalse(app.buttons["paywall-retry"].exists, "Retry state means StoreKit products did not load")
        XCTAssertFalse(app.staticTexts["Day 12 we remind you"].exists)
        XCTAssertFalse(app.staticTexts["Configuration Required"].exists, "Orange configuration card is on the paywall")
        XCTAssertFalse(app.buttons["Continue on the web"].exists)
        XCTAssertFalse(app.staticTexts["Continue on the web"].exists)
        let renewal = app.staticTexts["paywall-renewal"]
        XCTAssertTrue(renewal.waitForExistence(timeout: 8), "Renewal term missing from the bottom bar")
        XCTAssertTrue(renewal.label.contains("Renews automatically"), renewal.label)
        XCTAssertTrue(app.buttons["paywall-restore"].exists, "Restore Purchases missing from the bottom bar")
        XCTAssertTrue(app.buttons["Terms"].exists, "Terms missing from the bottom bar")
        XCTAssertTrue(app.buttons["Privacy"].exists, "Privacy missing from the bottom bar")
        XCTAssertEqual(app.state, .runningForeground)
        let paywallShot = try assertFullScreen(app, slug: slug, phase: "paywall")
        saveShot(paywallShot, name: "paywall-\(tag)")
    }

    /// Product.displayPrice plus /month or /year. No swipe while the fetch is in flight.
    private func waitForPriceLabel(_ app: XCUIApplication, id: String, timeout: TimeInterval) -> String {
        let price = app.staticTexts["paywall-price-\(id)"]
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if price.exists, !price.label.isEmpty {
                return price.label
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return price.exists ? price.label : ""
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
