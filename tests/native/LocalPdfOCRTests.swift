import XCTest
import Foundation

final class LocalPdfOCRTests: XCTestCase {
  func testIsolatedZeroAndNonzeroCellsWithoutInventingBlankValues() throws {
    guard let url = Bundle(for: Self.self).url(forResource: "report-a", withExtension: "pdf") else {
      throw XCTSkip("Private local PDF is not available")
    }
    let regions: [[String: Any]] = [
      ["pageIndex": 0, "rect": ["x": 0.36, "y": 0.443, "width": 0.15, "height": 0.015]],
      ["pageIndex": 0, "rect": ["x": 0.36, "y": 0.427, "width": 0.15, "height": 0.015]],
      ["pageIndex": 0, "rect": ["x": 0.36, "y": 0.55, "width": 0.15, "height": 0.015]],
    ]
    let result = try LocalPdfExtractor.recognizeRegions(url, regions: regions)
    let texts = result.map { (($0["spans"] as? [[String: Any]]) ?? []).compactMap { $0["text"] as? String }.joined() }
    XCTAssertEqual(texts, ["0", "9.9", ""])
    let zero = try XCTUnwrap((result[0]["spans"] as? [[String: Any]])?.first?["rect"] as? [String: Double])
    XCTAssertTrue((0.46...0.50).contains(zero["x"]!))
    XCTAssertTrue((0.443...0.458).contains(zero["y"]!))
    let automatic = try LocalPdfExtractor.recognizeRegions(url, regions: [["pageIndex": 0, "rect": ["x": 0.36, "y": 0.4428786945139317, "width": 0.15, "height": 0.01790825122883316]]])
    XCTAssertEqual((automatic[0]["spans"] as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined(), "0")
    let data = try JSONSerialization.data(withJSONObject: automatic)
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    attachment.name = "ocr-ios-cells.json"; attachment.lifetime = .keepAlways; add(attachment)
  }

  func testTextLayerStaysOnDirectExtraction() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sample-first", withExtension: "pdf"))
    let result = try LocalPdfExtractor.extract(url)
    let pages = try XCTUnwrap(result["pages"] as? [[String: Any]])
    XCTAssertEqual(pages.first?["extractionMethod"] as? String, "text")
  }

  func testPrivateReportsOnSimulator() throws {
    for name in ["a", "b"] {
      guard let url = Bundle(for: Self.self).url(forResource: "report-\(name)", withExtension: "pdf") else {
        throw XCTSkip("Private local PDFs are not available")
      }
      let result = try LocalPdfExtractor.extract(url)
      let pages = try XCTUnwrap(result["pages"] as? [[String: Any]])
      XCTAssertEqual(pages.count, 1)
      XCTAssertEqual(pages.first?["extractionMethod"] as? String, "ocr")
      XCTAssertGreaterThan((pages.first?["spans"] as? [[String: Any]])?.count ?? 0, 100)
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
      attachment.name = "ocr-ios-\(name).json"; attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}
