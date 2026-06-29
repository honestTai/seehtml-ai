#!/usr/bin/env swift

import AppKit
import Darwin
import Foundation
import Vision

struct ImageInfo: Codable {
    let path: String
    let filename: String
    let formatGuess: String?
    let width: Int
    let height: Int
    let colorSpace: String?
    let hasAlpha: Bool
    let bytes: Int64?
}

struct TextLine: Codable {
    let text: String
    let confidence: Float
    let boundingBox: [Double]
}

struct DominantColor: Codable {
    let hex: String
    let percent: Double
    let rgb: [Int]
}

struct ImageStats: Codable {
    let sampleCount: Int
    let uniqueColorBuckets: Int
    let meanSaturation: Double
    let nearGrayRatio: Double
    let darkRatio: Double
    let lightRatio: Double
    let edgeDensity: Double
}

struct OCRResult: Codable {
    let image: ImageInfo
    let text: [TextLine]
    let rawText: String
    let dominantColors: [DominantColor]
    let stats: ImageStats
    let categoryGuess: String
    let warnings: [String]
}

struct Bucket {
    var rSum: Int
    var gSum: Int
    var bSum: Int
    var count: Int
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func argValue(_ name: String, default defaultValue: String) -> String {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else {
        return defaultValue
    }
    return args[index + 1]
}

func hex(_ r: Int, _ g: Int, _ b: Int) -> String {
    String(format: "#%02X%02X%02X", r, g, b)
}

func clampByte(_ value: CGFloat) -> Int {
    max(0, min(255, Int((value * 255.0).rounded())))
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("usage: macos_vision_ocr.swift <image> [--languages zh-Hans,en-US] [--level accurate|fast]")
}

let imagePath = args[1]
let url = URL(fileURLWithPath: imagePath)
let languages = argValue("--languages", default: "zh-Hans,en-US")
    .split(separator: ",")
    .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
let level = argValue("--level", default: "accurate")

guard let nsImage = NSImage(contentsOf: url) else {
    fail("could not load image: \(imagePath)")
}
guard let tiff = nsImage.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
    fail("could not decode image pixels: \(imagePath)")
}

let width = cgImage.width
let height = cgImage.height
let attributes = try? FileManager.default.attributesOfItem(atPath: imagePath)
let byteCount = attributes?[.size] as? Int64
var warnings: [String] = []

func recognizeText(languageList: [String]) throws -> [TextLine] {
    var recognized: [TextLine] = []
    var requestError: Error?
    let request = VNRecognizeTextRequest { request, error in
        requestError = error
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            return
        }
        for observation in observations {
            guard let candidate = observation.topCandidates(1).first else {
                continue
            }
            let box = observation.boundingBox
            recognized.append(
                TextLine(
                    text: candidate.string,
                    confidence: candidate.confidence,
                    boundingBox: [box.origin.x, box.origin.y, box.size.width, box.size.height]
                )
            )
        }
    }
    request.recognitionLevel = level == "fast" ? .fast : .accurate
    request.usesLanguageCorrection = true
    if !languageList.isEmpty {
        request.recognitionLanguages = languageList
    }
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    if let requestError {
        throw requestError
    }
    return recognized
}

let textLines: [TextLine]
do {
    textLines = try recognizeText(languageList: languages)
} catch {
    warnings.append("OCR failed for requested languages \(languages.joined(separator: ",")); retried with default Vision languages. Error: \(error.localizedDescription)")
    do {
        textLines = try recognizeText(languageList: [])
    } catch {
        warnings.append("OCR fallback failed: \(error.localizedDescription)")
        textLines = []
    }
}

let maxSamples = 20000
let pixelTotal = max(1, width * height)
let step = max(1, Int(sqrt(Double(pixelTotal) / Double(maxSamples))))
var buckets: [Int: Bucket] = [:]
var sampleCount = 0
var saturationSum = 0.0
var nearGrayCount = 0
var darkCount = 0
var lightCount = 0
var edgeTransitions = 0
var edgeComparisons = 0

for y in stride(from: 0, to: height, by: step) {
    var previousLuminance: Double?
    for x in stride(from: 0, to: width, by: step) {
        guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else {
            continue
        }
        let r = clampByte(color.redComponent)
        let g = clampByte(color.greenComponent)
        let b = clampByte(color.blueComponent)
        let maxChannel = max(r, max(g, b))
        let minChannel = min(r, min(g, b))
        let saturation = maxChannel == 0 ? 0.0 : Double(maxChannel - minChannel) / Double(maxChannel)
        let luminance = (0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)) / 255.0

        saturationSum += saturation
        if maxChannel - minChannel < 18 {
            nearGrayCount += 1
        }
        if luminance < 0.22 {
            darkCount += 1
        }
        if luminance > 0.82 {
            lightCount += 1
        }
        if let previous = previousLuminance {
            edgeComparisons += 1
            if abs(luminance - previous) > 0.18 {
                edgeTransitions += 1
            }
        }
        previousLuminance = luminance

        let key = (r / 32) << 6 | (g / 32) << 3 | (b / 32)
        if var bucket = buckets[key] {
            bucket.rSum += r
            bucket.gSum += g
            bucket.bSum += b
            bucket.count += 1
            buckets[key] = bucket
        } else {
            buckets[key] = Bucket(rSum: r, gSum: g, bSum: b, count: 1)
        }
        sampleCount += 1
    }
}

let sortedBuckets = buckets.values.sorted { $0.count > $1.count }
let dominantColors = sortedBuckets.prefix(8).map { bucket -> DominantColor in
    let r = bucket.rSum / max(1, bucket.count)
    let g = bucket.gSum / max(1, bucket.count)
    let b = bucket.bSum / max(1, bucket.count)
    return DominantColor(
        hex: hex(r, g, b),
        percent: Double(bucket.count) / Double(max(1, sampleCount)),
        rgb: [r, g, b]
    )
}

let stats = ImageStats(
    sampleCount: sampleCount,
    uniqueColorBuckets: buckets.count,
    meanSaturation: saturationSum / Double(max(1, sampleCount)),
    nearGrayRatio: Double(nearGrayCount) / Double(max(1, sampleCount)),
    darkRatio: Double(darkCount) / Double(max(1, sampleCount)),
    lightRatio: Double(lightCount) / Double(max(1, sampleCount)),
    edgeDensity: Double(edgeTransitions) / Double(max(1, edgeComparisons))
)

let rawText = textLines.map(\.text).joined(separator: "\n")
let categoryGuess: String
if textLines.count >= 4 && stats.edgeDensity > 0.10 {
    categoryGuess = "document_or_screenshot_with_text"
} else if !textLines.isEmpty {
    categoryGuess = "image_with_some_text"
} else if stats.nearGrayRatio > 0.75 && stats.edgeDensity > 0.08 {
    categoryGuess = "grayscale_document_or_scan"
} else if stats.uniqueColorBuckets < 18 {
    categoryGuess = "simple_graphic_or_icon"
} else {
    categoryGuess = "photo_or_general_image"
}

let imageInfo = ImageInfo(
    path: url.path,
    filename: url.lastPathComponent,
    formatGuess: url.pathExtension.isEmpty ? nil : url.pathExtension.lowercased(),
    width: width,
    height: height,
    colorSpace: cgImage.colorSpace?.name as String?,
    hasAlpha: cgImage.alphaInfo != .none && cgImage.alphaInfo != .noneSkipFirst && cgImage.alphaInfo != .noneSkipLast,
    bytes: byteCount
)

let result = OCRResult(
    image: imageInfo,
    text: textLines,
    rawText: rawText,
    dominantColors: Array(dominantColors),
    stats: stats,
    categoryGuess: categoryGuess,
    warnings: warnings
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(result)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
