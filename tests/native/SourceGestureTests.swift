import XCTest

// Prepare with .maestro/source-preview-ready.yaml. Only touches the synthetic
// report's unsaved draft. Native multi-touch complements Maestro's tap coverage.
final class SourceGestureTests: XCTestCase {
  func testViewerPinchDragAndReturnToDraft() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.local.doctorrecords")
    app.activate()
    let image = app.images["source-image-0"]
    if !image.exists { app.buttons["source-toggle-0"].tap() }
    XCTAssertTrue(image.waitForExistence(timeout: 20))
    XCTAssertTrue(image.label.contains("丙氨酸氨基转移酶"), "Prepare only the synthetic ALT report")
    XCTAssertEqual(image.value as? String, "放大 1.0 倍")
    let initialY = image.frame.midY

    image.pinch(withScale: 2.5, velocity: 1)
    XCTAssertTrue(NSPredicate(format: "value != %@", "放大 1.0 倍").evaluate(with: image))
    XCTAssertEqual(image.frame.midY, initialY, accuracy: 2, "Pinching must not scroll the page")
    let beforeDrag = image.screenshot().pngRepresentation
    image.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: image.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)))
    XCTAssertEqual(image.frame.midY, initialY, accuracy: 2)
    XCTAssertNotEqual(image.screenshot().pngRepresentation, beforeDrag, "Dragging must move the enlarged image")
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "viewer-native-pinch"
    attachment.lifetime = .keepAlways
    add(attachment)

    image.pinch(withScale: 0.3, velocity: -1)
    XCTAssertEqual(image.value as? String, "放大 1.0 倍")
    image.doubleTap()
    XCTAssertEqual(image.value as? String, "放大 3.0 倍")
    image.doubleTap()
    XCTAssertEqual(image.value as? String, "放大 1.0 倍")
    app.buttons["close-source-preview"].tap()
    XCTAssertFalse(image.exists)
    XCTAssertEqual(app.textFields["value-0"].value as? String, "79")
    let thumbnail = app.buttons["source-toggle-0"]
    let thumbnailY = thumbnail.frame.midY
    thumbnail.tap()
    XCTAssertTrue(image.waitForExistence(timeout: 5))
    XCTAssertEqual(image.value as? String, "放大 1.0 倍")
    app.buttons["close-source-preview"].tap()
    XCTAssertEqual(thumbnail.frame.midY, thumbnailY, accuracy: 2)
  }
}
