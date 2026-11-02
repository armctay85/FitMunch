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
        for key in ["SIMULATOR_SHARED_RESOURCES_DIRECTORY", "SIMULATOR_HOST_HOME"] {
            if let shared = ProcessInfo.processInfo.environment[key], !shared.isEmpty {
                urls.append(URL(fileURLWithPath: shared).appendingPathComponent(name))
            }
        }
        for url in urls {
            try? Data("hold".utf8).write(to: url)
        }
        // 10s loses the frame on iPhone 11 Pro Max. simctl screenshot there
        // takes about 20s, and a late burst on iPhone 17 Pro Max still sees
        // the black pre-render when the hold is only 25s.
        Thread.sleep(forTimeInterval: 45)
        #endif
    }
}
