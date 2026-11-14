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
    /// Cap if the watcher never confirms. The full-screen test waits this out.
    static let holdSeconds: Double = 34
    static let confirmName = "fitmunch-launch-confirmed"
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
        // The clock starts in the cover task, when the hold is on screen.
        // Arming it here expires during a cold-simulator idle stall, and the
        // cover dismisses before the first frame the watcher can photograph.
        #endif
    }

    /// First visible frame of the hold. A later view refresh keeps this deadline.
    static func armWhenVisible() {
        #if DEBUG
        guard isRequested, deadline == nil else { return }
        deadline = Date().addingTimeInterval(holdSeconds)
        #endif
    }

    static func watcherConfirmed() -> Bool {
        #if DEBUG
        sharedURLs(named: confirmName).contains { FileManager.default.fileExists(atPath: $0.path) }
        #else
        true
        #endif
    }

    static func sharedURLs(named name: String) -> [URL] {
        var urls: [URL] = [
            URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name),
            URL(fileURLWithPath: "/tmp").appendingPathComponent(name),
        ]
        for key in ["SIMULATOR_SHARED_RESOURCES_DIRECTORY", "SIMULATOR_HOST_HOME", "HOME"] {
            if let shared = ProcessInfo.processInfo.environment[key], !shared.isEmpty {
                urls.append(URL(fileURLWithPath: shared).appendingPathComponent(name))
            }
        }
        return urls
    }
}

#if DEBUG
/// White field and the launch mark. Same pixels the system launch screen uses,
/// shown while the run loop stays free so `app.launch()` can return.
/// Release and App Store builds do not compile this view.
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
            NSLog("LAUNCH_FRAME_HOLD")
            for url in LaunchFrameCapture.sharedURLs(named: "fitmunch-launch-holding") {
                try? Data("hold".utf8).write(to: url)
            }
            LaunchFrameCapture.armWhenVisible()
            let deadline = LaunchFrameCapture.deadline ?? Date()
            while Date() < deadline {
                if LaunchFrameCapture.watcherConfirmed() {
                    break
                }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
            onFinished()
        }
    }
}
#endif
