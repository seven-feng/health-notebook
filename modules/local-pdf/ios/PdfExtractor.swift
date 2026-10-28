import Foundation
import PDFKit
import Vision
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

// Also compiled by the local fixture runner, so the tested extraction path is the app's path.
enum LocalPdfExtractor {
  private static func failure(_ code: String) -> NSError { NSError(domain: code, code: 1) }

  static func extract(_ url: URL) throws -> [String: Any] {
    guard let document = PDFDocument(url: url) else { throw failure("INVALID_PDF") }
    guard !document.isLocked else { throw failure("LOCKED_PDF") }
    guard (1...50).contains(document.pageCount) else { throw failure("INVALID_PAGE_COUNT") }
    let started = Date()
    var total = 0
    var pages: [[String: Any]] = []
    for index in 0..<document.pageCount {
      let result: [String: Any] = try autoreleasepool {
        guard Date().timeIntervalSince(started) < 120 else { throw failure("PDF_TIMEOUT") }
        guard let page = document.page(at: index) else { throw failure("INVALID_PAGE") }
        let bounds = page.bounds(for: .cropBox)
        guard bounds.width > 0, bounds.height > 0 else { throw failure("INVALID_PAGE") }
        let text = page.string ?? ""
        guard (text as NSString).length <= 20_000 else { throw failure("PAGE_TOO_COMPLEX") }
        let useful = text.filter { !$0.isWhitespace && $0 != "�" }.count
        let bad = text.filter { $0 == "�" }.count
        let useOCR = useful < 30 || bad * 20 > max(text.count, 1) || page.rotation % 360 != 0
        let spans: [[String: Any]]
        var numericSpans: [[String: Any]] = []
        var tableSpans: [[String: Any]] = []
        var readingLines: [[String: Any]] = []
        if useOCR {
          let recognized = try recognize(page)
          spans = recognized.0; numericSpans = recognized.1; tableSpans = recognized.2; readingLines = recognized.3
        } else {
          let content = text as NSString
          var characters: [[String: Any]] = []
          for n in 0..<content.length {
            if n % 100 == 0 && Date().timeIntervalSince(started) > 120 { throw failure("PDF_TIMEOUT") }
            let range = NSRange(location: n, length: 1)
            let value = content.substring(with: range)
            guard value != "\n", value != "\r", let selection = page.selection(for: range) else { continue }
            let rect = selection.bounds(for: page)
            guard !rect.isNull, rect.minX.isFinite else { continue }
            characters.append(["text": value, "rect": ["x": (rect.minX-bounds.minX)/bounds.width, "y": (bounds.maxY-rect.maxY)/bounds.height, "width": rect.width/bounds.width, "height": rect.height/bounds.height]])
          }
          spans = characters
          for line in page.selection(for: NSRange(location: 0, length: content.length))?.selectionsByLine() ?? [] {
            guard let value = line.string, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let rect = line.bounds(for: page)
            guard !rect.isNull, rect.minX.isFinite else { continue }
            readingLines.append(["text": value, "rect": ["x": (rect.minX-bounds.minX)/bounds.width, "y": (bounds.maxY-rect.maxY)/bounds.height, "width": rect.width/bounds.width, "height": rect.height/bounds.height]])
          }
        }
        total += (spans + numericSpans + tableSpans).reduce(0) { $0 + (($1["text"] as? String)?.count ?? 0) }
        guard total <= 100_000, spans.count + numericSpans.count + tableSpans.count <= 20_000 else { throw failure("PAGE_TOO_COMPLEX") }
        guard Date().timeIntervalSince(started) < 120 else { throw failure("PDF_TIMEOUT") }
        return ["pageIndex": index, "width": bounds.width, "height": bounds.height, "spans": spans, "readingLines": readingLines, "numericSpans": numericSpans, "tableSpans": tableSpans, "extractionMethod": useOCR ? "ocr" : "text"]
      }
      pages.append(result)
    }
    return ["pages": pages, "pageCount": document.pageCount]
  }

  // Retry only missing cells. Coordinates remain relative to the original page.
  static func recognizeRegions(_ url: URL, regions: [[String: Any]]) throws -> [[String: Any]] {
    guard regions.count <= 12, let document = PDFDocument(url: url), !document.isLocked,
          (1...50).contains(document.pageCount) else { throw failure("INVALID_REGIONS") }
    let started = Date()
    return try regions.map { region in
      try autoreleasepool {
        guard Date().timeIntervalSince(started) < 30,
              let index = region["pageIndex"] as? Int, index >= 0,
              let page = document.page(at: index), let r = region["rect"] as? [String: Double],
              let x = r["x"], let y = r["y"], let w = r["width"], let h = r["height"],
              [x,y,w,h].allSatisfy({ $0.isFinite }), x >= 0, y >= 0, w > 0, h > 0,
              w <= 0.3, h <= 0.08, x+w <= 1, y+h <= 1 else { throw failure("INVALID_REGIONS") }
        let full = try render(page)
        let crop = CGRect(x: x*Double(full.width), y: y*Double(full.height), width: w*Double(full.width), height: h*Double(full.height)).integral.intersection(CGRect(x: 0, y: 0, width: full.width, height: full.height))
        guard let cell = full.cropping(to: crop) else { throw failure("OCR_RENDER_FAILED") }
        // Vision can discard a lone character in a short, wide strip. A white
        // margin supplies detection space without adding or guessing any text.
        let padding = Double(cell.height * 3)
        let canvasWidth = Double(cell.width) + padding*2, canvasHeight = Double(cell.height) + padding*2
        let scale = min(3.0, 2400.0 / max(canvasWidth, canvasHeight))
        let width = max(1, Int(canvasWidth*scale)), height = max(1, Int(canvasHeight*scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw failure("OCR_RENDER_FAILED") }
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.draw(cell, in: CGRect(x: padding*scale, y: padding*scale, width: Double(cell.width)*scale, height: Double(cell.height)*scale))
        guard let enlarged = context.makeImage() else { throw failure("OCR_RENDER_FAILED") }
        var spans = try recognizeImage(enlarged, languages: ["en-US"], minimumTextHeight: 0).compactMap { span -> [String: Any]? in
          var next = span
          guard let box = span["rect"] as? [String: CGFloat] else { return nil }
          do {
            let localX = Double(box["x"]!)*Double(width)/scale-padding, localY = Double(box["y"]!)*Double(height)/scale-padding
            let localW = Double(box["width"]!)*Double(width)/scale, localH = Double(box["height"]!)*Double(height)/scale
            guard localX+localW/2 >= 0, localY+localH/2 >= 0,
                  localX+localW/2 <= crop.width, localY+localH/2 <= crop.height else { return nil }
            next["rect"] = ["x": (crop.minX+localX)/Double(full.width),
                            "y": (crop.minY+localY)/Double(full.height),
                            "width": localW/Double(full.width), "height": localH/Double(full.height)]
          }
          return next
        }
        if spans.isEmpty {
          spans = try recognizeIsolatedCell(cell).map { span in
            var next = span
            let box = span["rect"] as! [String: Double]
            next["rect"] = ["x": (crop.minX+box["x"]!*crop.width)/Double(full.width),
                            "y": (crop.minY+box["y"]!*crop.height)/Double(full.height),
                            "width": box["width"]!*crop.width/Double(full.width),
                            "height": box["height"]!*crop.height/Double(full.height)]
            return next
          }
        }
        guard spans.count <= 200 else { throw failure("PAGE_TOO_COMPLEX") }
        return ["pageIndex": index, "rect": r, "spans": spans]
      }
    }
  }

  private static func recognizeIsolatedCell(_ cell: CGImage) throws -> [[String: Any]] {
    guard let pixels = CGContext(data: nil, width: cell.width, height: cell.height, bitsPerComponent: 8,
                                 bytesPerRow: cell.width*4, space: CGColorSpaceCreateDeviceRGB(),
                                 bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return [] }
    pixels.draw(cell, in: CGRect(x: 0, y: 0, width: cell.width, height: cell.height))
    guard let bytes = pixels.data?.assumingMemoryBound(to: UInt8.self) else { return [] }
    var left = cell.width, top = cell.height, right = -1, bottom = -1
    for y in 0..<cell.height { for x in 0..<cell.width {
      let offset = y*pixels.bytesPerRow+x*4
      if max(bytes[offset], max(bytes[offset+1], bytes[offset+2])) < 160 {
        left = min(left,x); right = max(right,x); top = min(top,y); bottom = max(bottom,y)
      }
    }}
    guard right >= left, bottom >= top else { return [] }
    let ink = CGRect(x: left, y: top, width: right-left+1, height: bottom-top+1)
    guard let glyphs = cell.cropping(to: ink) else { return [] }
    let inkWidth = Double(ink.width), inkHeight = Double(ink.height)
    for targetHeight in [64.0, 48.0, 96.0] {
      let width = 1600, height = 900
      let scale = min(targetHeight/inkHeight, 1200/inkWidth)
      let dx = (Double(width)-inkWidth*scale)/2, dy = (Double(height)-inkHeight*scale)/2
      guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return [] }
      context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
      context.interpolationQuality = .high
      context.draw(glyphs, in: CGRect(x: dx, y: dy, width: inkWidth*scale, height: inkHeight*scale))
      guard let bitmap = context.makeImage() else { return [] }
      let found = try recognizeImage(bitmap, languages: ["en-US"], minimumTextHeight: 0)
      let text = found.compactMap { $0["text"] as? String }.joined()
      guard text.range(of: "^[<>≤≥]?[+-]?[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil else { continue }
      var mapped: [[String: Any]] = []
      for span in found {
        guard let box = span["rect"] as? [String: CGFloat] else { continue }
        var result = span
        let px: Double = (Double(box["x"]!)*Double(width)-dx)/scale
        let py: Double = (Double(box["y"]!)*Double(height)-dy)/scale
        let pw: Double = Double(box["width"]!)*Double(width)/scale
        let ph: Double = Double(box["height"]!)*Double(height)/scale
        let normalized: [String: Double] = ["x": (Double(left)+px)/Double(cell.width), "y": (Double(top)+py)/Double(cell.height),
                                            "width": pw/Double(cell.width), "height": ph/Double(cell.height)]
        result["rect"] = normalized
        mapped.append(result)
      }
      return mapped
    }
    return []
  }

  private static func render(_ page: PDFPage) throws -> CGImage {
    let thumbnail = page.thumbnail(of: CGSize(width: 2200, height: 3100), for: .cropBox)
    #if canImport(UIKit)
    guard let image = thumbnail.cgImage else { throw failure("OCR_RENDER_FAILED") }
    #else
    guard let data = thumbnail.tiffRepresentation, let image = NSBitmapImageRep(data: data)?.cgImage else { throw failure("OCR_RENDER_FAILED") }
    #endif
    guard image.width <= 3200, image.height <= 3200 else { throw failure("OCR_RENDER_TOO_LARGE") }
    return image
  }

  private static func recognize(_ page: PDFPage) throws -> ([[String: Any]], [[String: Any]], [[String: Any]], [[String: Any]]) {
    let image = try render(page)
    var readingLines: [[String: Any]] = []
    let primary = try recognizeImage(image, languages: ["zh-Hans", "en-US"], onLine: { readingLines.append($0) })
    let numeric = try recognizeImage(image, languages: ["en-US"])
    // Enlarging a small screenshot can erase thin strokes in table headers.
    // Keep a second Chinese read at a smaller scale, with separate provenance.
    let scale = min(1.0, 1400.0 / Double(max(image.width, image.height)))
    let width = max(1, Int(Double(image.width)*scale)), height = max(1, Int(Double(image.height)*scale))
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return (primary, numeric, [], readingLines) }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let smaller = context.makeImage() else { return (primary, numeric, [], readingLines) }
    return (primary, numeric, (try? recognizeImage(smaller, languages: ["zh-Hans", "en-US"], minimumTextHeight: 0)) ?? [], readingLines)
  }

  private static func recognizeImage(_ image: CGImage, languages: [String], minimumTextHeight: Float? = nil, onLine: (([String: Any]) -> Void)? = nil) throws -> [[String: Any]] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    if let minimumTextHeight = minimumTextHeight { request.minimumTextHeight = minimumTextHeight }
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = false
    #if targetEnvironment(simulator)
    request.usesCPUOnly = true
    #endif
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    var spans: [[String: Any]] = []
    for observation in request.results ?? [] {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let lineRect = observation.boundingBox
      onLine?(["text": candidate.string, "confidence": candidate.confidence, "rect": ["x": lineRect.minX, "y": 1-lineRect.maxY, "width": lineRect.width, "height": lineRect.height]])
      var characters: [[String: Any]] = []
      var missingGeometry = false
      // Character geometry keeps arrows outside right-aligned numeric cells.
      for start in candidate.string.indices {
        let end = candidate.string.index(after: start)
        let character = String(candidate.string[start..<end])
        guard !character.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        guard let box = try candidate.boundingBox(for: start..<end) else { missingGeometry = true; break }
        let r = box.boundingBox
        characters.append(["text": character, "confidence": candidate.confidence, "rect": ["x": r.minX, "y": 1-r.maxY, "width": r.width, "height": r.height]])
      }
      if missingGeometry {
        let r = observation.boundingBox
        spans.append(["text": candidate.string, "confidence": candidate.confidence, "rect": ["x": r.minX, "y": 1-r.maxY, "width": r.width, "height": r.height]])
      } else { spans.append(contentsOf: characters) }
    }
    return spans
  }
}
