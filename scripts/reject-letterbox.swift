#!/usr/bin/env swift
import AppKit
import Foundation

/// Fail when a store capture has a thick black band. XCUIScreen letterboxes
/// this app; simctl framebuffer shots should be full bleed.
/// Usage: swift scripts/reject-letterbox.swift <directory>

let names = ["home.png", "coach.png", "scan.png", "plan.png", "settings.png", "workout.png", "history.png"]

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: reject-letterbox.swift <directory>\n", stderr)
    exit(2)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
var failed = false

func bitmap(_ url: URL) -> NSBitmapImageRep? {
    guard let image = NSImage(contentsOf: url),
          let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff) else {
        return nil
    }
    return rep
}

func blackFraction(_ rep: NSBitmapImageRep, x0: Int, x1: Int, y0: Int, y1: Int) -> Double {
    var dark = 0
    var total = 0
    let stepX = max(1, (x1 - x0) / 48)
    let stepY = max(1, (y1 - y0) / 24)
    var y = y0
    while y < y1 {
        var x = x0
        while x < x1 {
            if let color = rep.colorAt(x: x, y: y) {
                total += 1
                if color.redComponent < 0.04 && color.greenComponent < 0.04 && color.blueComponent < 0.04 {
                    dark += 1
                }
            }
            x += stepX
        }
        y += stepY
    }
    if total == 0 { return 0 }
    return Double(dark) / Double(total)
}

for name in names {
    let url = root.appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: url.path), let rep = bitmap(url) else {
        fputs("missing or unreadable \(url.path)\n", stderr)
        failed = true
        continue
    }
    let w = rep.pixelsWide
    let h = rep.pixelsHigh
    let bandY = max(1, h * 8 / 100)
    let bandX = max(1, w * 6 / 100)
    let top = blackFraction(rep, x0: 0, x1: w, y0: 0, y1: bandY)
    let bottom = blackFraction(rep, x0: 0, x1: w, y0: h - bandY, y1: h)
    let left = blackFraction(rep, x0: 0, x1: bandX, y0: 0, y1: h)
    let right = blackFraction(rep, x0: w - bandX, x1: w, y0: 0, y1: h)
    print(String(format: "letterbox %@ top=%.2f bottom=%.2f left=%.2f right=%.2f", name, top, bottom, left, right))
    if top > 0.85 || bottom > 0.85 || left > 0.85 || right > 0.85 {
        fputs("\(name) is letterboxed\n", stderr)
        failed = true
    }
}

exit(failed ? 1 : 0)
