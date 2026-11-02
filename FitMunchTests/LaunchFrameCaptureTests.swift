import XCTest
@testable import FitMunch

/// The 30s launch cover is a UI-test hook. Release and App Store builds must
/// not compile it, and a Debug build must not show it without -CaptureLaunch.
final class LaunchFrameCaptureTests: XCTestCase {
    func testHoldDoesNotRunWithoutCaptureArgument() {
        XCTAssertFalse(
            ProcessInfo.processInfo.arguments.contains(LaunchFrameCapture.argument),
            "The unit-test host must not pass \(LaunchFrameCapture.argument)"
        )
        XCTAssertFalse(LaunchFrameCapture.isRequested)
        LaunchFrameCapture.deadline = nil
        LaunchFrameCapture.holdIfRequested()
        XCTAssertNil(
            LaunchFrameCapture.deadline,
            "holdIfRequested armed the 30s cover without -CaptureLaunch"
        )
    }

    func testCoverAndHoldAreCompiledOnlyInDebug() throws {
        let capture = try bundledSource("LaunchFrameCapture")
        let app = try bundledSource("FitMunchApp")

        XCTAssertEqual(occurrences(of: "struct LaunchFrameCover", in: capture).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "struct LaunchFrameCover", in: capture).inside, 0)
        XCTAssertEqual(occurrences(of: "LAUNCH_FRAME_HOLD", in: capture).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "LAUNCH_FRAME_HOLD", in: capture).inside, 0)
        XCTAssertEqual(occurrences(of: "deadline = Date()", in: capture).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "deadline = Date()", in: capture).inside, 0)

        let requested = occurrences(of: "arguments.contains(argument)", in: capture)
        XCTAssertEqual(requested.outside, 0)
        XCTAssertGreaterThan(requested.inside, 0)
        XCTAssertTrue(
            capture.contains("#else\n        false\n        #endif"),
            "Release isRequested must be a constant false"
        )

        XCTAssertEqual(occurrences(of: "LaunchFrameCover", in: app).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "LaunchFrameCover", in: app).inside, 0)
        XCTAssertEqual(occurrences(of: "holdIfRequested()", in: app).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "holdIfRequested()", in: app).inside, 0)
        XCTAssertEqual(occurrences(of: "showingLaunchHold", in: app).outside, 0)
        XCTAssertGreaterThan(occurrences(of: "showingLaunchHold", in: app).inside, 0)
    }

    private func bundledSource(_ name: String) throws -> String {
        let bundle = Bundle(for: LaunchFrameCaptureTests.self)
        let url = try XCTUnwrap(
            bundle.url(forResource: name, withExtension: "swift"),
            "\(name).swift is not in the unit-test bundle"
        )
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// Counts a marker inside an active `#if DEBUG` region and outside one.
    /// `#else` of `#if DEBUG` is outside, which is the Release branch.
    private func occurrences(of marker: String, in source: String) -> (inside: Int, outside: Int) {
        var stack: [(parentActive: Bool, ifTaken: Bool)] = []
        var active = true
        var inside = 0
        var outside = 0
        for raw in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#if ") {
                let debug = line == "#if DEBUG"
                stack.append((active, debug))
                active = active && debug
            } else if line.hasPrefix("#elseif ") {
                if let top = stack.popLast() {
                    active = false
                    stack.append((top.parentActive, true))
                }
            } else if line == "#else" {
                if let top = stack.popLast() {
                    active = top.parentActive && !top.ifTaken
                    stack.append((top.parentActive, true))
                }
            } else if line.hasPrefix("#endif") {
                active = stack.popLast()?.parentActive ?? true
            } else if raw.contains(marker) {
                if active { inside += 1 } else { outside += 1 }
            }
        }
        return (inside, outside)
    }
}
