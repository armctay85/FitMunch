import Foundation
import os
import SwiftUI
import UIKit

/// Times the UI-test path from the first laid-out frame to the Today row that
/// shows a real calorie count. Release builds never arm this. The launch
/// argument is `-MealLogTiming`, and only the meal-log speed test passes it.
final class MealLogTiming: ObservableObject {
    static let argument = "-MealLogTiming"
    static let shared = MealLogTiming()

    @Published private(set) var report: String = "interval=pending"

    private static let log = OSLog(subsystem: "com.fitmunch.app", category: "PointsOfInterest")
    private static let signpostID = OSSignpostID(log: log)
    private static let fileName = "meal-log-signpost.txt"

    private let processAt = Date()
    private var firstFrameAt: Date?
    private var intervalSeconds: Double?
    private var loggedCalories = 0
    private var typedCalories = 0
    private var widthPoints = 0
    private var order: [String] = []
    private var marks: [String: TimeInterval] = [:]
    private var didBegin = false
    private var didEnd = false
    private var clearedFiles = false

    static var isEnabled: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains(argument)
        #else
        false
        #endif
    }

    private init() {}

    func mark(_ phase: String, overwrite: Bool = false) {
        guard Self.isEnabled else { return }
        if marks[phase] != nil, !overwrite { return }
        if marks[phase] == nil {
            order.append(phase)
        }
        marks[phase] = Date().timeIntervalSince(processAt)
        publish(phase: phase)
    }

    func markFirstFrame(width: Int) {
        guard Self.isEnabled, !didBegin else { return }
        didBegin = true
        firstFrameAt = Date()
        widthPoints = width
        os_signpost(.begin, log: Self.log, name: "LaunchToLoggedKcal", signpostID: Self.signpostID)
        mark("firstFrame")
    }

    func markCaloriesTyped(_ calories: Int) {
        guard Self.isEnabled, calories > 0 else { return }
        typedCalories = calories
        if marks["caloriesFirst"] == nil {
            os_signpost(.event, log: Self.log, name: "CaloriesFirst")
            mark("caloriesFirst")
        }
        os_signpost(.event, log: Self.log, name: "CaloriesLatest")
        mark("caloriesLatest", overwrite: true)
    }

    func markRowShown(calories: Int) {
        guard Self.isEnabled, calories > 0, !didEnd else { return }
        didEnd = true
        loggedCalories = calories
        let ended = Date()
        if let firstFrameAt {
            intervalSeconds = ended.timeIntervalSince(firstFrameAt)
        }
        os_signpost(.end, log: Self.log, name: "LaunchToLoggedKcal", signpostID: Self.signpostID)
        mark("rowShown")
    }

    private func publish(phase: String) {
        let line = snapshot(phase: phase)
        report = rendered
        NSLog("%@", line)
        write(line)
    }

    private var rendered: String {
        var parts: [String] = []
        if let intervalSeconds {
            parts.append(String(format: "interval=%.3f", intervalSeconds))
        } else {
            parts.append("interval=pending")
        }
        parts.append("calories=\(loggedCalories)")
        parts.append("typed=\(typedCalories)")
        if widthPoints > 0 {
            parts.append("width=\(widthPoints)")
        }
        for name in order {
            if let time = marks[name] {
                parts.append(String(format: "%@=%.3f", name, time))
            }
        }
        return parts.joined(separator: " ")
    }

    private func snapshot(phase: String) -> String {
        let wall = String(format: "%.3f", Date().timeIntervalSince1970)
        return "MEAL_LOG_SIGNPOST wall=\(wall) phase=\(phase) \(rendered)"
    }

    private func write(_ line: String) {
        let data = Data((line + "\n").utf8)
        for url in destinations() {
            do {
                try FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                if !clearedFiles || !FileManager.default.fileExists(atPath: url.path) {
                    try data.write(to: url, options: .atomic)
                } else if let handle = FileHandle(forWritingAtPath: url.path) {
                    defer { handle.closeFile() }
                    _ = handle.seekToEndOfFile()
                    handle.write(data)
                } else {
                    try data.write(to: url, options: .atomic)
                }
            } catch {
                continue
            }
        }
        clearedFiles = true
    }

    private func destinations() -> [URL] {
        var urls: [URL] = []
        if let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            urls.append(documents.appendingPathComponent(Self.fileName))
        }
        urls.append(URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(Self.fileName))
        urls.append(URL(fileURLWithPath: "/tmp").appendingPathComponent(Self.fileName))
        for key in ["SIMULATOR_SHARED_RESOURCES_DIRECTORY", "SIMULATOR_HOST_HOME"] {
            if let shared = ProcessInfo.processInfo.environment[key], !shared.isEmpty {
                urls.append(URL(fileURLWithPath: shared).appendingPathComponent(Self.fileName))
            }
        }
        return urls
    }
}

/// Zero-hit-target marker so the signpost starts when the first real frame is laid out.
struct MealLogTimingHost: View {
    var body: some View {
        if MealLogTiming.isEnabled {
            ZStack {
                FirstFrameMarker()
                MealLogTimingProbe()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false)
        }
    }
}

private struct MealLogTimingProbe: View {
    @ObservedObject private var timing = MealLogTiming.shared

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityIdentifier("meal-log-signpost")
            .accessibilityLabel(timing.report)
    }
}

private struct FirstFrameMarker: UIViewRepresentable {
    func makeUIView(context: Context) -> FirstFrameView {
        FirstFrameView()
    }

    func updateUIView(_ uiView: FirstFrameView, context: Context) {}
}

private final class FirstFrameView: UIView {
    private var armed = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        isAccessibilityElement = false
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard !armed, window != nil, bounds.width > 1 else { return }
        armed = true
        MealLogTiming.shared.markFirstFrame(width: Int(bounds.width.rounded()))
    }
}
