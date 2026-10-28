import XCTest
import Foundation

// Optional local corpus, never bundled into the application target.
final class PublicReportOCRTests: XCTestCase {
  func testPublicReportCorpus() throws {
    let urls = (Bundle(for: Self.self).urls(forResourcesWithExtension: "pdf", subdirectory: nil) ?? [])
      .filter { $0.lastPathComponent.range(of: "^[0-9]{2}-", options: .regularExpression) != nil }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    guard !urls.isEmpty else { throw XCTSkip("Set DOCTOR_OCR_FIXTURES to a local corpus directory") }
    for url in urls {
      let started = Date()
      var result = try LocalPdfExtractor.extract(url)
      result["elapsedMs"] = Date().timeIntervalSince(started) * 1000
      let pages = try XCTUnwrap(result["pages"] as? [[String: Any]])
      XCTAssertEqual(pages.count, 1)
      XCTAssertEqual(pages.first?["extractionMethod"] as? String, "ocr")
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
      attachment.name = "public-ios-\(url.deletingPathExtension().lastPathComponent).json"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}
