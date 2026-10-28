import XCTest
import PDFKit
import UIKit

final class PhotoDocumentTests: XCTestCase {
  func testImageDocumentKeepsPixelsAndUsesLocalOCR() throws {
    let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sample-first", withExtension: "pdf"))
    let original = try XCTUnwrap(PDFDocument(url: source))
    let page = try XCTUnwrap(original.page(at: 0))
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let photo = directory.appendingPathComponent("photo.jpg"), document = directory.appendingPathComponent("photo.pdf")
    try XCTUnwrap(page.thumbnail(of: CGSize(width: 2000, height: 2600), for: .cropBox).jpegData(compressionQuality: 1)).write(to: photo)
    XCTAssertEqual(original.pageCount, 1)
    try PhotoDocument.write(photo, to: document)
    let pdf = try XCTUnwrap(PDFDocument(url: document))
    XCTAssertEqual(pdf.pageCount, 1)
    XCTAssertTrue(pdf.string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    let result = try LocalPdfExtractor.extract(document)
    let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
    attachment.name = "photo-extraction-ios.json"; attachment.lifetime = .keepAlways; add(attachment)
    let parsed = try XCTUnwrap((result["pages"] as? [[String: Any]])?.first)
    XCTAssertEqual(parsed["extractionMethod"] as? String, "ocr")
    let texts = (parsed["spans"] as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined() ?? ""
    XCTAssertTrue(texts.contains("ALT"), texts); XCTAssertTrue(texts.contains("100"), texts); XCTAssertTrue(texts.contains("5.4"), texts)
  }
  func testInvalidImageCannotCreateAnEmptyDocument() throws {
    let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
    let target = source.appendingPathExtension("pdf")
    defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: target) }
    try Data("not an image".utf8).write(to: source)
    XCTAssertThrowsError(try PhotoDocument.write(source, to: target))
    XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
  }
}
