import Foundation
import PDFKit
import UIKit

enum PdfRegionRenderer {
  // Rendering calls are serialized by the module. Keep only one bounded page;
  // multiple row previews reuse it without retaining whole documents.
  private static let pages: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.countLimit = 1
    cache.totalCostLimit = 32 * 1024 * 1024
    return cache
  }()

  static func render(_ url: URL, page index: Int, rect: [String: Double], target: URL) throws -> [String: Int] {
    func failure() -> NSError { NSError(domain: "PREVIEW_UNAVAILABLE", code: 1) }
    guard let x = rect["x"], let y = rect["y"], let w = rect["width"], let h = rect["height"],
          [x,y,w,h].allSatisfy({ $0.isFinite }), x >= 0, y >= 0, w > 0, h > 0,
          x+w <= 1.000001, y+h <= 1.000001, index >= 0, index < 50,
          url.isFileURL, target.isFileURL else { throw failure() }
    return try autoreleasepool {
      let key = "\(url.absoluteString)#\(index)" as NSString
      let full: CGImage
      if let image = pages.object(forKey: key)?.cgImage { full = image }
      else {
        guard let document = PDFDocument(url: url), !document.isLocked,
              let page = document.page(at: index) else { throw failure() }
        let thumbnail = page.thumbnail(of: CGSize(width: 2200, height: 3100), for: .cropBox)
        guard let image = thumbnail.cgImage, image.width <= 3200, image.height <= 3200 else { throw failure() }
        pages.setObject(thumbnail, forKey: key, cost: image.bytesPerRow * image.height)
        full = image
      }
      let bounds = CGRect(x: 0, y: 0, width: full.width, height: full.height)
      let crop = CGRect(x: x*Double(full.width), y: y*Double(full.height),
                        width: w*Double(full.width), height: h*Double(full.height)).integral.intersection(bounds)
      guard let image = full.cropping(to: crop), let data = UIImage(cgImage: image).pngData() else { throw failure() }
      try data.write(to: target, options: [.atomic, .completeFileProtection])
      var protectedURL = target
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      try protectedURL.setResourceValues(values)
      return ["width": image.width, "height": image.height]
    }
  }
}
