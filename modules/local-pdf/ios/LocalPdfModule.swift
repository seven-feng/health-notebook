import ExpoModulesCore
import PDFKit
import CryptoKit

private func fileURL(_ uri: String) throws -> URL {
  guard let url = URL(string: uri), url.isFileURL else { throw NSError(domain: "INVALID_FILE", code: 1) }
  return url
}

public class LocalPdfAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    if let url = launchOptions?[.url] as? URL { IncomingPdfInbox.shared.receive(url) }
    return true
  }

  public func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    IncomingPdfInbox.shared.receive(url)
  }
}

public class LocalPdfModule: Module {
  private let previewQueue = DispatchQueue(label: "doctor.pdf-previews", qos: .userInitiated)
  public func definition() -> ModuleDefinition {
    Name("LocalPdf")
    Events("onIncomingFile")
    OnStartObserving("onIncomingFile") {
      NotificationCenter.default.addObserver(self, selector: #selector(self.incomingFileChanged), name: incomingPdfChanged, object: nil)
    }
    OnStopObserving("onIncomingFile") {
      NotificationCenter.default.removeObserver(self, name: incomingPdfChanged, object: nil)
    }
    AsyncFunction("imageToPdf") { (uri: String, target: String) throws in
      try PhotoDocument.write(fileURL(uri), to: fileURL(target))
    }.runOnQueue(previewQueue)
    AsyncFunction("renderRegion") { (uri: String, page: Int, rect: [String: Double], target: String) throws -> [String: Int] in
      try PdfRegionRenderer.render(fileURL(uri), page: page, rect: rect, target: fileURL(target))
    }.runOnQueue(previewQueue)
    AsyncFunction("extract") { (uri: String) throws -> [String: Any] in
      return try LocalPdfExtractor.extract(fileURL(uri))
    }.runOnQueue(.global(qos: .userInitiated))

    AsyncFunction("recognizeRegions") { (uri: String, regions: [[String: Any]]) throws -> [[String: Any]] in
      return try LocalPdfExtractor.recognizeRegions(fileURL(uri), regions: regions)
    }.runOnQueue(.global(qos: .userInitiated))

    AsyncFunction("hashFile") { (uri: String) throws -> String in
      let handle = try FileHandle(forReadingFrom: fileURL(uri)); defer { try? handle.close() }
      var digest = SHA256()
      while let chunk = try handle.read(upToCount: 65536), !chunk.isEmpty { digest.update(data: chunk) }
      return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }.runOnQueue(.global(qos: .utility))

    AsyncFunction("protectFile") { (uri: String) throws in
      var url = try fileURL(uri); var values = URLResourceValues(); values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    }
    AsyncFunction("getIncomingFiles") { () -> [String] in
      IncomingPdfInbox.shared.files()
    }
    AsyncFunction("takeIncomingError") { () -> String? in
      IncomingPdfInbox.shared.takeError()
    }
    AsyncFunction("deleteIncomingFile") { (uri: String) throws in
      try IncomingPdfInbox.shared.remove(fileURL(uri))
    }
    View(LocalPdfView.self) {
      Prop("uri") { (view, uri: String) in view.setURI(uri) }
      Prop("page") { (view, page: Int) in view.goTo(page) }
    }
  }

  @objc private func incomingFileChanged(_ notification: Notification) {
    sendEvent("onIncomingFile", [:])
  }
}

class LocalPdfView: ExpoView {
  private let pdf = PDFView()
  private var pageNumber = 0
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    pdf.autoScales = true; pdf.displayMode = .singlePage; pdf.backgroundColor = UIColor.white
    addSubview(pdf)
  }
  override func layoutSubviews() { super.layoutSubviews(); pdf.frame = bounds }
  func setURI(_ uri: String) {
    guard let url = URL(string: uri), url.isFileURL else { return }
    if pdf.document?.documentURL != url { pdf.document = PDFDocument(url: url) }
    goTo(pageNumber)
  }
  func goTo(_ index: Int) { pageNumber = index; if let page = pdf.document?.page(at: index) { pdf.go(to: page) } }
}
