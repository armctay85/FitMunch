import XCTest
@testable import FitMunch

/// The 30s launch cover is a UI-test hook. Release keeps it out with #if DEBUG.
/// This test checks the behavior a Debug process can actually observe.
final class LaunchFrameCaptureTests: XCTestCase {
    func testHoldDoesNotRunWithoutCaptureArgument() {
        XCTAssertFalse(
            ProcessInfo.processInfo.arguments.contains(LaunchFrameCapture.argument),
            "The unit-test host must not pass \(LaunchFrameCapture.argument)"
        )
        XCTAssertFalse(LaunchFrameCapture.isRequested)
        LaunchFrameCapture.deadline = nil
        LaunchFrameCapture.holdIfRequested()
        LaunchFrameCapture.armWhenVisible()
        XCTAssertNil(
            LaunchFrameCapture.deadline,
            "holdIfRequested armed the 30s cover without -CaptureLaunch"
        )
    }
}
