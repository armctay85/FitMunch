#!/usr/bin/env swift
import AppKit
import Foundation
import Vision

/// Fail if App Store PNGs contain $ / Free / trial. Runs on the macos-26 runner.
/// Usage: swift scripts/ocr-store-screenshots.swift <directory>

let forbidden = ["$", "free", "trial"]
let required = ["home.png", "coach.png", "scan.png", "plan.png", "settings.png"]

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: ocr-store-screenshots.swift <directory>\n", stderr)
    exit(2)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
var failed = false

func recognize(_ url: URL) throws -> String {
    guard let image = NSImage(contentsOf: url),
          let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let cg = bitmap.cgImage else {
        throw NSError(domain: "ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable \(url.lastPathComponent)"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try handler.perform([request])
    return (request.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
}

for name in required {
    let url = root.appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: url.path) else {
        fputs("missing \(url.path)\n", stderr)
        failed = true
        continue
    }
    do {
        let text = try recognize(url)
        let lower = text.lowercased()
        print("OCR \(name):\n\(text)\n")
        for token in forbidden where lower.contains(token) {
            fputs("\(name) contains rejected token '\(token)'\n", stderr)
            failed = true
        }
    } catch {
        fputs("OCR failed for \(name): \(error)\n", stderr)
        failed = true
    }
}

exit(failed ? 1 : 0)
