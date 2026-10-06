import Foundation

/// Holds the system launch screen long enough for CI to photograph it.
/// The argument is a test hook and the hold does not exist in Release.
enum LaunchFrameCapture {
    static let argument = "-CaptureLaunch"

    static func holdIfRequested() {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains(argument) else { return }
        NSLog("LAUNCH_FRAME_HOLD")
        let name = "fitmunch-launch-holding"
        var urls: [URL] = [
            URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name),
            URL(fileURLWithPath: "/tmp").appendingPathComponent(name),
        ]
        if let shared = ProcessInfo.processInfo.environment["SIMULATOR_SHARED_RESOURCES_DIRECTORY"], !shared.isEmpty {
            urls.append(URL(fileURLWithPath: shared).appendingPathComponent(name))
        }
        for url in urls {
            try? Data("hold".utf8).write(to: url)
        }
        Thread.sleep(forTimeInterval: 10)
        #endif
    }
}
