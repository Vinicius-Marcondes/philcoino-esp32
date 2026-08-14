import CryptoKit
import ESPProvision
import ExpoModulesCore
import Foundation
import Security

public final class PhilcoinoSecureTransportModule: Module {
  private var requestTasks: [String: URLSessionDataTask] = [:]
  private var streamTasks: [String: Task<Void, Never>] = [:]
  private let taskLock = NSLock()
  private var pinnedSessions: [String: PinnedSession] = [:]
  private let sessionLock = NSLock()
  private var srpContexts: [String: SrpContext] = [:]
  private let srpLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("PhilcoinoSecureTransport")
    Events("onSseEvent")
    Constant("pairingProtocolVersion") { 4 }

    AsyncFunction("secureRandom") { (byteLength: Int) throws -> [String: String] in
      guard byteLength >= 16 && byteLength <= 64 else {
        throw TransportError.invalidRequest
      }
      var bytes = [UInt8](repeating: 0, count: byteLength)
      let status = bytes.withUnsafeMutableBytes { buffer in
        SecRandomCopyBytes(kSecRandomDefault, byteLength, buffer.baseAddress!)
      }
      guard status == errSecSuccess else {
        throw TransportError.randomUnavailable
      }
      let data = Data(bytes)
      return [
        "base64Url": Self.encodeBase64Url(data),
        "hex": bytes.map { String(format: "%02x", $0) }.joined(),
      ]
    }

    AsyncFunction("srpStart") {
      (sessionHandle: String, pairingCode: String) throws -> String in
      guard pairingCode.range(of: "^[0-9]{8}$", options: .regularExpression) != nil else {
        throw TransportError.invalidPairingCode
      }
      self.srpLock.lock()
      defer { self.srpLock.unlock() }
      guard self.srpContexts[sessionHandle] == nil,
            self.srpContexts.count < 2 else {
        throw TransportError.srpSessionUnavailable
      }
      let client = Client<SHA512>(
        username: "philcoino-v3",
        password: pairingCode,
        group: .N3072
      )
      guard let publicKey = Self.leftPad(client.publicKey, to: 384) else {
        throw TransportError.invalidSrpValue
      }
      self.srpContexts[sessionHandle] = SrpContext(client: client)
      return Self.encodeBase64Url(publicKey)
    }

    AsyncFunction("srpProcessChallenge") {
      (sessionHandle: String, saltBase64Url: String,
       serverPublicKeyBase64Url: String) throws -> String in
      guard let salt = Self.decodeBase64Url(saltBase64Url),
            let serverPublicKey = Self.decodeBase64Url(serverPublicKeyBase64Url) else {
        throw TransportError.invalidSrpValue
      }
      self.srpLock.lock()
      defer { self.srpLock.unlock() }
      guard let context = self.srpContexts[sessionHandle],
            context.key == nil else {
        throw TransportError.srpSessionUnavailable
      }
      let result = try context.client.processChallenge(
        salt: salt,
        publicKey: serverPublicKey
      )
      let sessionKey = result.sessionKey.withUnsafeBytes { Data($0) }
      guard sessionKey.count >= 32 else {
        throw TransportError.invalidSrpValue
      }
      // ESP-IDF, Android, and the simulator use the first 256 bits of the
      // SHA-512 SRP session key as the AES-GCM binding key.
      context.key = SymmetricKey(data: sessionKey.prefix(32))
      return Self.encodeBase64Url(result.clientVerify)
    }

    AsyncFunction("srpVerifyServer") {
      (sessionHandle: String, serverProofBase64Url: String,
       deviceNonceBase64Url: String) throws in
      guard let serverProof = Self.decodeBase64Url(serverProofBase64Url),
            let nonce = Self.decodeBase64Url(deviceNonceBase64Url),
            nonce.count == 12,
            nonce.suffix(4) == Data([0, 0, 0, 1]) else {
        throw TransportError.invalidSrpValue
      }
      self.srpLock.lock()
      defer { self.srpLock.unlock() }
      guard let context = self.srpContexts[sessionHandle],
            context.key != nil,
            context.nonce == nil else {
        throw TransportError.srpSessionUnavailable
      }
      try context.client.verifySession(keyProof: serverProof)
      context.nonce = nonce
    }

    AsyncFunction("srpDecrypt") {
      (sessionHandle: String, ciphertextBase64Url: String) throws -> String in
      guard let ciphertext = Self.decodeBase64Url(ciphertextBase64Url),
            ciphertext.count > 16 else {
        throw TransportError.invalidSrpValue
      }
      self.srpLock.lock()
      defer { self.srpLock.unlock() }
      guard let context = self.srpContexts[sessionHandle],
            context.client.isAuthenticated,
            let key = context.key,
            let nonceData = context.nonce else {
        throw TransportError.srpSessionUnavailable
      }
      let nonce = try AES.GCM.Nonce(data: nonceData)
      let sealed = try AES.GCM.SealedBox(
        nonce: nonce,
        ciphertext: ciphertext.dropLast(16),
        tag: ciphertext.suffix(16)
      )
      let plaintext = try AES.GCM.open(sealed, using: key)
      context.nonce = try Self.incrementNonce(nonceData)
      guard let value = String(data: plaintext, encoding: .utf8) else {
        throw TransportError.invalidResponse
      }
      return value
    }

    AsyncFunction("srpEncrypt") {
      (sessionHandle: String, plaintext: String) throws -> String in
      self.srpLock.lock()
      defer { self.srpLock.unlock() }
      guard let context = self.srpContexts[sessionHandle],
            context.client.isAuthenticated,
            let key = context.key,
            let nonceData = context.nonce else {
        throw TransportError.srpSessionUnavailable
      }
      let nonce = try AES.GCM.Nonce(data: nonceData)
      let sealed = try AES.GCM.seal(
        Data(plaintext.utf8),
        using: key,
        nonce: nonce
      )
      context.nonce = try Self.incrementNonce(nonceData)
      return Self.encodeBase64Url(sealed.ciphertext + sealed.tag)
    }

    Function("srpDestroy") { (sessionHandle: String) in
      self.srpLock.lock()
      self.srpContexts.removeValue(forKey: sessionHandle)
      self.srpLock.unlock()
    }

    AsyncFunction("request") {
      (requestId: String, request: [String: Any]) async throws -> [String: Any] in
      let prepared = try Self.prepare(request)
      let reusableSession = prepared.pin.map {
        self.pinnedSession(origin: prepared.origin, pin: $0)
      }
      let delegate = reusableSession?.delegate ?? PinningDelegate(
        expectedPin: nil,
        bootstrapAllowed: prepared.bootstrap
      )
      let disposableSession = reusableSession == nil
        ? Self.makeSession(delegate: delegate)
        : nil
      let session = reusableSession?.session ?? disposableSession!
      defer { disposableSession?.invalidateAndCancel() }
      defer { removeRequest(requestId) }
      let (data, response) = try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<(Data, URLResponse), Error>) in
        let task = session.dataTask(with: prepared.request) {
          data, response, error in
          if let error {
            continuation.resume(throwing: error)
          } else if let data, let response {
            continuation.resume(returning: (data, response))
          } else {
            continuation.resume(throwing: TransportError.invalidResponse)
          }
        }
        self.taskLock.lock()
        self.requestTasks.removeValue(forKey: requestId)?.cancel()
        self.requestTasks[requestId] = task
        self.taskLock.unlock()
        task.resume()
      }
      guard let http = response as? HTTPURLResponse else {
        throw TransportError.invalidResponse
      }
      return [
        "status": http.statusCode,
        "body": String(decoding: data, as: UTF8.self),
        "presentedPin": delegate.presentedPin ?? prepared.pin ?? "",
      ]
    }

    Function("cancelRequest") { (requestId: String) in
      self.taskLock.lock()
      let task = self.requestTasks.removeValue(forKey: requestId)
      self.taskLock.unlock()
      task?.cancel()
    }

    AsyncFunction("startSse") {
      (requestId: String, request: [String: Any]) in
      let task = Task { [weak self] in
        guard let self else { return }
        do {
          let prepared = try Self.prepare(request)
          guard prepared.pin != nil else {
            throw TransportError.unpinnedRestricted
          }
          let delegate = PinningDelegate(
            expectedPin: prepared.pin,
            bootstrapAllowed: false
          )
          let session = URLSession(
            configuration: .ephemeral,
            delegate: delegate,
            delegateQueue: nil
          )
          defer { session.invalidateAndCancel() }
          let (bytes, response) = try await session.bytes(for: prepared.request)
          guard let http = response as? HTTPURLResponse,
                (200...299).contains(http.statusCode) else {
            throw TransportError.invalidResponse
          }
          var chunk = Data()
          for try await byte in bytes {
            try Task.checkCancellation()
            chunk.append(byte)
            if chunk.count >= 1024 {
              self.sendEvent("onSseEvent", [
                "requestId": requestId,
                "type": "data",
                "body": String(decoding: chunk, as: UTF8.self),
              ])
              chunk.removeAll(keepingCapacity: true)
            }
          }
          if !chunk.isEmpty {
            self.sendEvent("onSseEvent", [
              "requestId": requestId,
              "type": "data",
              "body": String(decoding: chunk, as: UTF8.self),
            ])
          }
          self.sendEvent("onSseEvent", [
            "requestId": requestId,
            "type": "closed",
          ])
        } catch is CancellationError {
          // Explicit cancellation is not surfaced as a transport failure.
        } catch {
          self.sendEvent("onSseEvent", [
            "requestId": requestId,
            "type": "error",
            "body": String(describing: error),
          ])
        }
        self.removeStream(requestId)
      }
      taskLock.lock()
      streamTasks[requestId]?.cancel()
      streamTasks[requestId] = task
      taskLock.unlock()
    }

    Function("cancelSse") { (requestId: String) in
      self.taskLock.lock()
      let task = self.streamTasks.removeValue(forKey: requestId)
      self.taskLock.unlock()
      task?.cancel()
    }

    OnDestroy {
      self.taskLock.lock()
      let requests = self.requestTasks.values
      self.requestTasks.removeAll()
      let streams = self.streamTasks.values
      self.streamTasks.removeAll()
      self.taskLock.unlock()
      requests.forEach { $0.cancel() }
      streams.forEach { $0.cancel() }
      self.sessionLock.lock()
      let sessions = self.pinnedSessions.values
      self.pinnedSessions.removeAll()
      self.sessionLock.unlock()
      sessions.forEach { $0.session.invalidateAndCancel() }
      self.srpLock.lock()
      self.srpContexts.removeAll()
      self.srpLock.unlock()
    }
  }

  private func removeStream(_ requestId: String) {
    taskLock.lock()
    streamTasks.removeValue(forKey: requestId)
    taskLock.unlock()
  }

  private func removeRequest(_ requestId: String) {
    taskLock.lock()
    requestTasks.removeValue(forKey: requestId)
    taskLock.unlock()
  }

  private func pinnedSession(origin: String, pin: String) -> PinnedSession {
    let key = origin + "\n" + pin
    sessionLock.lock()
    defer { sessionLock.unlock() }
    if let existing = pinnedSessions[key] {
      return existing
    }
    let created = PinnedSession(pin: pin)
    pinnedSessions[key] = created
    return created
  }

  fileprivate static func makeSession(delegate: PinningDelegate) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    // The ESP32-C3 HTTPS server has a deliberately small socket budget. One
    // persistent control connection avoids repeated TLS handshakes and keeps
    // the separate SSE connection from causing socket churn.
    configuration.httpMaximumConnectionsPerHost = 1
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(
      configuration: configuration,
      delegate: delegate,
      delegateQueue: nil
    )
  }

  private struct PreparedRequest {
    let request: URLRequest
    let origin: String
    let pin: String?
    let bootstrap: Bool
  }

  private static func prepare(
    _ value: [String: Any]
  ) throws -> PreparedRequest {
    guard let origin = value["origin"] as? String,
          let path = value["path"] as? String,
          let method = value["method"] as? String,
          let timeoutMs = value["timeoutMs"] as? Double,
          let url = URL(string: origin + path),
          url.scheme == "https" else {
      throw TransportError.invalidRequest
    }
    let pin = value["pin"] as? String
    let bootstrap = pin == nil && method == "POST" &&
      Self.isUnpinnedPairingPath(path)
    if pin == nil && !bootstrap {
      throw TransportError.unpinnedRestricted
    }
    var request = URLRequest(
      url: url,
      timeoutInterval: timeoutMs / 1000.0
    )
    request.httpMethod = method
    if let headers = value["headers"] as? [String: String] {
      headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
    }
    if let body = value["body"] as? String {
      request.httpBody = Data(body.utf8)
    }
    return PreparedRequest(
      request: request,
      origin: origin,
      pin: pin,
      bootstrap: bootstrap
    )
  }

  private static func decodeBase64Url(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }

  fileprivate static func encodeBase64Url(_ value: Data) -> String {
    value.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func leftPad(_ value: Data, to length: Int) -> Data? {
    guard value.count <= length else { return nil }
    return Data(repeating: 0, count: length - value.count) + value
  }

  private static func incrementNonce(_ value: Data) throws -> Data {
    guard value.count == 12 else { throw TransportError.invalidSrpValue }
    var bytes = [UInt8](value)
    var counter = UInt32(bytes[8]) << 24
    counter |= UInt32(bytes[9]) << 16
    counter |= UInt32(bytes[10]) << 8
    counter |= UInt32(bytes[11])
    guard counter < UInt32.max else { throw TransportError.invalidSrpValue }
    counter += 1
    bytes[8] = UInt8((counter >> 24) & 0xff)
    bytes[9] = UInt8((counter >> 16) & 0xff)
    bytes[10] = UInt8((counter >> 8) & 0xff)
    bytes[11] = UInt8(counter & 0xff)
    return Data(bytes)
  }

  private static func isUnpinnedPairingPath(_ path: String) -> Bool {
    if path == "/api/v3/pairing/sessions" { return true }
    let pattern = "^/api/v3/pairing/sessions/[0-9a-f]{32}/proof$"
    return path.range(of: pattern, options: .regularExpression) != nil
  }
}

private final class PinnedSession {
  let delegate: PinningDelegate
  let session: URLSession

  init(pin: String) {
    let delegate = PinningDelegate(expectedPin: pin, bootstrapAllowed: false)
    self.delegate = delegate
    self.session = PhilcoinoSecureTransportModule.makeSession(delegate: delegate)
  }
}

private final class SrpContext {
  let client: Client<SHA512>
  var key: SymmetricKey?
  var nonce: Data?

  init(client: Client<SHA512>) {
    self.client = client
  }
}

private final class PinningDelegate: NSObject, URLSessionDelegate {
  private let expectedPin: String?
  private let bootstrapAllowed: Bool
  private(set) var presentedPin: String?

  init(expectedPin: String?, bootstrapAllowed: Bool) {
    self.expectedPin = expectedPin
    self.bootstrapAllowed = bootstrapAllowed
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (
      URLSession.AuthChallengeDisposition,
      URLCredential?
    ) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod ==
            NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let certificate = SecTrustGetCertificateAtIndex(trust, 0),
          let key = SecCertificateCopyKey(certificate),
          let rawKey = SecKeyCopyExternalRepresentation(key, nil) as Data?
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    // ASN.1 SubjectPublicKeyInfo prefix for a P-256 uncompressed public key.
    let prefix = Data([
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE,
      0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D,
      0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ])
    let pin = PhilcoinoSecureTransportModule.encodeBase64Url(
      Data(SHA256.hash(data: prefix + rawKey))
    )
    presentedPin = pin
    if bootstrapAllowed || expectedPin == pin {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}

private enum TransportError: Error {
  case invalidPairingCode
  case invalidRequest
  case invalidResponse
  case invalidSrpValue
  case randomUnavailable
  case srpSessionUnavailable
  case unpinnedRestricted
}
