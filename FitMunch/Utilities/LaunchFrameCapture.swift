import Foundation
import SwiftUI

/// Holds a launch-screen replica long enough for CI to photograph it.
/// The argument is a test hook and the hold does not exist in Release.
///
/// Sleeping the main thread kept the system launch screen up, and it also
/// stopped XCTest's launch from returning. On iPhone 11 Pro Max that sleep
/// plus startup crossed the 60s launch timeout, and simctl screenshot blocked
/// until the sleep ended, so the frame it saved was no longer the launch screen.
enum LaunchFrameCapture {
    static let argument = "-CaptureLaunch"
    /// Long enough for one slow simctl screenshot on iPhone 11 Pro Max.
    static let holdSeconds: Double = 30
    /// Absolute end time so a view refresh does not start the 30s over.
    static var deadline: Date?

    static var isRequested: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains(argument)
        #else
        false
        #endif
    }

    static func holdIfRequested() {
        #if DEBUG
        guard isRequested else { return }
        NSLog("LAUNCH_FRAME_HOLD")
        let name = "fitmunch-launch-holding"
        var urls: [URL] = [
            URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name),
            URL(fileURLWithPath: "/tmp").appendingPathComponent(name),
        ]
        for key in ["SIMULATOR_SHARED_RESOURCES_DIRECTORY", "SIMULATOR_HOST_HOME"] {
            if let shared = ProcessInfo.processInfo.environment[key], !shared.isEmpty {
                urls.append(URL(fileURLWithPath: shared).appendingPathComponent(name))
            }
        }
        for url in urls {
            try? Data("hold".utf8).write(to: url)
        }
        deadline = Date().addingTimeInterval(holdSeconds)
        #endif
    }
}

/// White field and the launch mark. Same pixels the system launch screen uses,
/// shown while the run loop stays free so `app.launch()` can return.
struct LaunchFrameCover: View {
    var onFinished: () -> Void

    var body: some View {
        ZStack {
            Color("LaunchBackground")
            Image("LaunchLogo")
                .accessibilityHidden(true)
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("launch-frame-cover")
        .task {
            let remaining = LaunchFrameCapture.deadline?.timeIntervalSinceNow ?? 0
            if remaining > 0 {
                try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            }
            onFinished()
        }
    }
}
