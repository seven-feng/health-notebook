import UIKit
import ImageIO

// Input is an upright, metadata-free image from the local image editor.
// Keep its pixels in a single-page document so OCR, source crops and recovery
// use exactly the same geometry as the image the user confirmed.
enum PhotoDocument {
  static func write(_ source: URL, to target: URL) throws {
    guard let data = CGImageSourceCreateWithURL(source as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(data, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 3200, height <= 3200,
          let image = UIImage(contentsOfFile: source.path) else {
      throw NSError(domain: "INVALID_REPORT_IMAGE", code: 1)
    }
    let scale = 800.0 / Double(max(width, height))
    let bounds = CGRect(x: 0, y: 0, width: Double(width) * scale, height: Double(height) * scale)
    do {
      try UIGraphicsPDFRenderer(bounds: bounds).writePDF(to: target) { context in
        context.beginPage()
        UIColor.white.setFill(); context.cgContext.fill(bounds)
        image.draw(in: bounds)
      }
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      var url = target; try url.setResourceValues(values)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
    } catch {
      try? FileManager.default.removeItem(at: target)
      throw error
    }
  }
}
