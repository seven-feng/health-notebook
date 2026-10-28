import Foundation

let incomingPdfChanged = Notification.Name("doctor.incomingPdfChanged")

/// iOS may deliver a document directly into Documents/Inbox, including when
/// launching an app that wasn't running. Both inboxes must survive JS startup.
final class IncomingPdfInbox {
  static let shared = IncomingPdfInbox(
    local: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("incoming", isDirectory: true),
    system: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Inbox", isDirectory: true)
  )
  let local: URL
  let system: URL
  private let manager = FileManager.default
  private let defaults: UserDefaults
  private let errorKey = "doctor.incomingPdfError"

  init(local: URL, system: URL, defaults: UserDefaults = .standard) {
    self.local = local.standardizedFileURL.resolvingSymlinksInPath()
    self.system = system.standardizedFileURL.resolvingSymlinksInPath()
    self.defaults = defaults
  }

  @discardableResult
  func receive(_ url: URL) -> Bool {
    guard url.isFileURL, url.pathExtension.lowercased() == "pdf" else { return false }
    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
    do {
      var coordinationError: NSError?
      var readError: Error?
      NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { source in
        do { try self.stage(source) } catch { readError = error }
      }
      if let error = coordinationError ?? (readError as NSError?) { throw error }
    } catch {
      // Persist only a user-facing error; never filenames, paths or report data.
      let message = (error as NSError).domain == "INCOMING_TOO_LARGE"
        ? "这份报告超过 20 MB，暂时无法导入。"
        : "未能接收这份 PDF，请从原应用重新打开，或先存到“文件”再导入。"
      defaults.set(message, forKey: errorKey)
    }
    // A dedicated signal runs after the file is ready. AppState/Linking may
    // have already fired, and cold launches recover from the persisted files.
    NotificationCenter.default.post(name: incomingPdfChanged, object: nil)
    return true
  }

  private func stage(_ source: URL) throws {
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw NSError(domain: "INVALID_INCOMING_FILE", code: 1)
    }
    guard let size = values.fileSize, size <= 20 * 1024 * 1024 else {
      throw NSError(domain: "INCOMING_TOO_LARGE", code: 1)
    }
    let normalized = source.standardizedFileURL.resolvingSymlinksInPath()
    if [local.path, system.path].contains(normalized.deletingLastPathComponent().path) {
      try protect(normalized)
      return
    }
    try manager.createDirectory(at: local, withIntermediateDirectories: true)
    let pending = local.appendingPathComponent(UUID().uuidString + ".pending")
    defer { try? manager.removeItem(at: pending) }
    try manager.copyItem(at: source, to: pending)
    try protect(pending)
    // Don't expose a partially copied file to a simultaneous foreground scan.
    try manager.moveItem(at: pending, to: pending.deletingPathExtension().appendingPathExtension("pdf"))
  }

  func files() -> [String] {
    [local, system].flatMap { folder -> [URL] in
      (try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])) ?? []
    }.filter { url in
      guard url.pathExtension.lowercased() == "pdf",
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else { return false }
      return values.isRegularFile == true && values.isSymbolicLink != true
    }.sorted { $0.path < $1.path }.map { $0.absoluteString }
  }

  func remove(_ url: URL) throws {
    let normalized = url.standardizedFileURL.resolvingSymlinksInPath()
    guard [local.path, system.path].contains(normalized.deletingLastPathComponent().path),
          normalized.pathExtension.lowercased() == "pdf" else {
      throw NSError(domain: "INVALID_INCOMING_FILE", code: 1)
    }
    guard manager.fileExists(atPath: normalized.path) else { return }
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw NSError(domain: "INVALID_INCOMING_FILE", code: 1)
    }
    try manager.removeItem(at: normalized)
  }

  func takeError() -> String? {
    let message = defaults.string(forKey: errorKey)
    defaults.removeObject(forKey: errorKey)
    return message
  }

  private func protect(_ url: URL) throws {
    var target = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try target.setResourceValues(values)
    try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
  }
}
