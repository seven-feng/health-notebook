import XCTest
import Foundation

final class IncomingPdfInboxTests: XCTestCase {
  private var root: URL!
  private var inbox: IncomingPdfInbox!
  private var preferences: UserDefaults!
  private var suite: String!

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    suite = "doctor.inbox-tests.\(UUID().uuidString)"
    preferences = UserDefaults(suiteName: suite)
    inbox = IncomingPdfInbox(local: root.appendingPathComponent("Application Support/incoming"),
      system: root.appendingPathComponent("Documents/Inbox"), defaults: preferences)
    try FileManager.default.createDirectory(at: inbox.local, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: inbox.system, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try FileManager.default.removeItem(at: root)
    preferences.removePersistentDomain(forName: suite)
  }

  private func pdf(_ url: URL) throws {
    try Data("%PDF-1.4\nsynthetic inbox test\n%%EOF".utf8).write(to: url)
  }

  func testColdLaunchFindsSystemInboxWithoutAnOpenURLEvent() throws {
    let systemFile = inbox.system.appendingPathComponent("微信 测试报告.PDF")
    let legacyFile = inbox.local.appendingPathComponent("legacy.pdf")
    try pdf(systemFile); try pdf(legacyFile)
    let restarted = IncomingPdfInbox(local: inbox.local, system: inbox.system, defaults: preferences)
    XCTAssertEqual(Set(restarted.files()), Set([systemFile.absoluteString, legacyFile.absoluteString]))
    // Reading the queue must not consume the only source before durable import.
    XCTAssertTrue(FileManager.default.fileExists(atPath: systemFile.path))
    try restarted.remove(systemFile)
    XCTAssertEqual(restarted.files(), [legacyFile.absoluteString])
    try restarted.remove(systemFile) // Retry after a successful deletion is safe.
  }

  func testWarmReceiptPublishesOnlyAfterTheCompleteFileIsAvailable() throws {
    let source = root.appendingPathComponent("external.pdf")
    try pdf(source)
    var received: [String] = []
    let observer = NotificationCenter.default.addObserver(forName: incomingPdfChanged, object: nil, queue: nil) { _ in
      received = self.inbox.files()
    }
    defer { NotificationCenter.default.removeObserver(observer) }
    XCTAssertTrue(inbox.receive(source))
    XCTAssertEqual(received.count, 1)
    let staged = try XCTUnwrap(received.first.flatMap(URL.init(string:)))
    XCTAssertEqual(try Data(contentsOf: staged), try Data(contentsOf: source))
    XCTAssertNotEqual(staged, source)
    XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    XCTAssertNil(inbox.takeError())
  }

  func testSystemURLDeliveryDoesNotMultiplyQueuedFiles() throws {
    let source = inbox.system.appendingPathComponent("report.pdf")
    try pdf(source)
    XCTAssertTrue(inbox.receive(source))
    XCTAssertTrue(inbox.receive(source))
    XCTAssertEqual(inbox.files(), [source.absoluteString])
  }

  func testOnlyRegularPDFsCanBeListedAndOnlyInboxCopiesDeleted() throws {
    let original = root.appendingPathComponent("saved.pdf")
    try pdf(original)
    try FileManager.default.createSymbolicLink(at: inbox.local.appendingPathComponent("link.pdf"), withDestinationURL: original)
    try FileManager.default.createDirectory(at: inbox.system.appendingPathComponent("directory.pdf"), withIntermediateDirectories: true)
    try pdf(inbox.local.appendingPathComponent("unfinished.pending"))
    XCTAssertTrue(inbox.files().isEmpty)
    XCTAssertThrowsError(try inbox.remove(original))
    XCTAssertThrowsError(try inbox.remove(inbox.local.appendingPathComponent("link.pdf")))
    XCTAssertThrowsError(try inbox.remove(inbox.system.appendingPathComponent("directory.pdf")))
    XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
  }

  func testFailedReceiptSurvivesRestartAndDoesNotLeaveAPartialFile() throws {
    XCTAssertTrue(inbox.receive(root.appendingPathComponent("missing.pdf")))
    let restarted = IncomingPdfInbox(local: inbox.local, system: inbox.system, defaults: preferences)
    XCTAssertNotNil(restarted.takeError())
    XCTAssertNil(restarted.takeError())
    XCTAssertTrue(restarted.files().isEmpty)
    XCTAssertFalse(inbox.receive(URL(string: "doctorrecords://records")!))
  }

  func testOversizedExternalFileIsNotCopiedAndHasAnActionableError() throws {
    let source = root.appendingPathComponent("large.pdf")
    try pdf(source)
    let file = try FileHandle(forWritingTo: source)
    try file.truncate(atOffset: 20 * 1024 * 1024 + 1)
    try file.close()
    XCTAssertTrue(inbox.receive(source))
    XCTAssertTrue(inbox.files().isEmpty)
    XCTAssertTrue(inbox.takeError()?.contains("20 MB") == true)
  }
}
