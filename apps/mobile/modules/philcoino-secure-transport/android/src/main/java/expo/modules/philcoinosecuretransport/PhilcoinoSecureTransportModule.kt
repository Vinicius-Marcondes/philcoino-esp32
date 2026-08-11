package expo.modules.philcoinosecuretransport

import android.util.Base64
import com.espressif.provisioning.srp6a.BigIntegerUtils
import com.espressif.provisioning.srp6a.SRP6ClientSession
import com.espressif.provisioning.srp6a.SRP6CryptoParams
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Arrays
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class PhilcoinoSecureTransportModule : Module() {
  private val executor = Executors.newCachedThreadPool()
  private val requests = ConcurrentHashMap<String, HttpsURLConnection>()
  private val cancelledRequests = ConcurrentHashMap.newKeySet<String>()
  private val streams = ConcurrentHashMap<String, HttpsURLConnection>()
  private val srpContexts = ConcurrentHashMap<String, SrpContext>()
  private val secureRandom = SecureRandom()

  override fun definition() = ModuleDefinition {
    Name("PhilcoinoSecureTransport")
    Events("onSseEvent")
    Constant("pairingProtocolVersion") { 4 }

    AsyncFunction("secureRandom") { byteLength: Int ->
      require(byteLength in 16..64) { "Secure random length is out of range" }
      val bytes = ByteArray(byteLength)
      secureRandom.nextBytes(bytes)
      mapOf(
        "base64Url" to encodeBase64Url(bytes),
        "hex" to bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) },
      )
    }

    AsyncFunction("srpStart") { sessionHandle: String, pairingCode: String ->
      require(pairingCode.matches(Regex("^[0-9]{8}$"))) {
        "Pairing code must contain exactly eight digits"
      }
      synchronized(srpContexts) {
        check(!srpContexts.containsKey(sessionHandle) && srpContexts.size < 2) {
          "SRP session capacity is unavailable"
        }
        val client = SRP6ClientSession()
        client.step1("philcoino-v3", pairingCode)
        val params = SRP6CryptoParams.getInstance(3072, "SHA-512")
        val publicKey = leftPad(
          BigIntegerUtils.bigIntegerToBytes(client.getClientPublicKey(params)),
          384,
        )
        srpContexts[sessionHandle] = SrpContext(client, params)
        encodeBase64Url(publicKey)
      }
    }

    AsyncFunction("srpProcessChallenge") {
        sessionHandle: String, saltBase64Url: String,
        serverPublicKeyBase64Url: String ->
      val context = srpContexts[sessionHandle]
        ?: throw IllegalStateException("SRP session is unavailable")
      synchronized(context) {
        check(context.key == null) { "SRP challenge was already processed" }
        val salt = decodeBase64Url(saltBase64Url)
        val serverPublicKey = decodeBase64Url(serverPublicKeyBase64Url)
        val credentials = context.client.step2_for_client_evidence(
          context.params,
          BigIntegerUtils.bigIntegerFromBytes(salt),
          BigIntegerUtils.bigIntegerFromBytes(serverPublicKey),
          salt,
        )
        context.key = Arrays.copyOfRange(
          BigIntegerUtils.bigIntegerToBytes(context.client.K), 0, 32,
        )
        encodeBase64Url(leftPad(
          BigIntegerUtils.bigIntegerToBytes(credentials.M1), 64,
        ))
      }
    }

    AsyncFunction("srpVerifyServer") {
        sessionHandle: String, serverProofBase64Url: String,
        deviceNonceBase64Url: String ->
      val context = srpContexts[sessionHandle]
        ?: throw IllegalStateException("SRP session is unavailable")
      synchronized(context) {
        val proof = decodeBase64Url(serverProofBase64Url)
        val nonce = decodeBase64Url(deviceNonceBase64Url)
        require(proof.size == 64 && nonce.size == 12 &&
          nonce.copyOfRange(8, 12).contentEquals(byteArrayOf(0, 0, 0, 1))) {
          "Invalid SRP proof or device nonce"
        }
        check(context.nonce == null && context.key != null) {
          "SRP session is in the wrong stage"
        }
        context.client.step3(BigIntegerUtils.bigIntegerFromBytes(proof))
        context.nonce = nonce
      }
    }

    AsyncFunction("srpDecrypt") {
        sessionHandle: String, ciphertextBase64Url: String ->
      val context = srpContexts[sessionHandle]
        ?: throw IllegalStateException("SRP session is unavailable")
      synchronized(context) {
        val key = context.key ?: throw IllegalStateException("SRP key is unavailable")
        val nonce = context.nonce ?: throw IllegalStateException("SRP nonce is unavailable")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.DECRYPT_MODE,
          SecretKeySpec(key, "AES"),
          GCMParameterSpec(128, nonce),
        )
        val plaintext = cipher.doFinal(decodeBase64Url(ciphertextBase64Url))
        context.nonce = incrementNonce(nonce)
        String(plaintext, StandardCharsets.UTF_8)
      }
    }

    AsyncFunction("srpEncrypt") { sessionHandle: String, plaintext: String ->
      val context = srpContexts[sessionHandle]
        ?: throw IllegalStateException("SRP session is unavailable")
      synchronized(context) {
        val key = context.key ?: throw IllegalStateException("SRP key is unavailable")
        val nonce = context.nonce ?: throw IllegalStateException("SRP nonce is unavailable")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.ENCRYPT_MODE,
          SecretKeySpec(key, "AES"),
          GCMParameterSpec(128, nonce),
        )
        val encrypted = cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))
        context.nonce = incrementNonce(nonce)
        encodeBase64Url(encrypted)
      }
    }

    Function("srpDestroy") { sessionHandle: String ->
      srpContexts.remove(sessionHandle)?.clear()
    }

    AsyncFunction("request") { requestId: String, request: Map<String, Any?> ->
      performRequest(requestId, request)
    }

    Function("cancelRequest") { requestId: String ->
      cancelledRequests.add(requestId)
      requests.remove(requestId)?.disconnect()
    }

    AsyncFunction("startSse") {
        requestId: String, request: Map<String, Any?> ->
      executor.execute { runSse(requestId, request) }
    }

    Function("cancelSse") { requestId: String ->
      streams.remove(requestId)?.disconnect()
    }

    OnDestroy {
      requests.values.forEach { it.disconnect() }
      requests.clear()
      cancelledRequests.clear()
      streams.values.forEach { it.disconnect() }
      streams.clear()
      srpContexts.values.forEach { it.clear() }
      srpContexts.clear()
      executor.shutdownNow()
    }
  }

  private fun performRequest(
    requestId: String,
    request: Map<String, Any?>,
  ): Map<String, Any> {
    if (cancelledRequests.remove(requestId)) {
      throw IOException("Request cancelled")
    }
    val connection = try {
      open(request) {
        requests[requestId] = it
        if (cancelledRequests.remove(requestId)) {
          requests.remove(requestId)
          it.disconnect()
          throw IOException("Request cancelled")
        }
      }
    } catch (error: Throwable) {
      requests.remove(requestId)?.disconnect()
      cancelledRequests.remove(requestId)
      throw error
    }
    return try {
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val body = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() } ?: ""
      mapOf(
        "status" to status,
        "body" to body,
        "presentedPin" to
          (connection.sslSocketFactory as? PinningSocketFactory)?.presentedPin.orEmpty(),
      )
    } finally {
      requests.remove(requestId)
      cancelledRequests.remove(requestId)
      connection.disconnect()
    }
  }

  private fun runSse(requestId: String, request: Map<String, Any?>) {
    val connection = try {
      open(request)
    } catch (error: Throwable) {
      sendEvent("onSseEvent", mapOf(
        "requestId" to requestId,
        "type" to "error",
        "body" to (error.message ?: "TLS connection failed"),
      ))
      return
    }
    streams[requestId] = connection
    try {
      val status = connection.responseCode
      if (status !in 200..299) {
        val body = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
        sendEvent("onSseEvent", mapOf(
          "requestId" to requestId, "type" to "error", "body" to "$status:$body",
        ))
        return
      }
      BufferedReader(InputStreamReader(connection.inputStream, StandardCharsets.UTF_8)).use { reader ->
        val buffer = CharArray(1024)
        while (!Thread.currentThread().isInterrupted) {
          val count = reader.read(buffer)
          if (count < 0) break
          sendEvent("onSseEvent", mapOf(
            "requestId" to requestId,
            "type" to "data",
            "body" to String(buffer, 0, count),
          ))
        }
      }
      sendEvent("onSseEvent", mapOf("requestId" to requestId, "type" to "closed"))
    } catch (error: Throwable) {
      if (streams.containsKey(requestId)) {
        sendEvent("onSseEvent", mapOf(
          "requestId" to requestId,
          "type" to "error",
          "body" to (error.message ?: "SSE disconnected"),
        ))
      }
    } finally {
      streams.remove(requestId)
      connection.disconnect()
    }
  }

  private fun open(
    request: Map<String, Any?>,
    onCreated: (HttpsURLConnection) -> Unit = {},
  ): HttpsURLConnection {
    val origin = request["origin"] as? String
      ?: throw IllegalArgumentException("origin is required")
    val path = request["path"] as? String
      ?: throw IllegalArgumentException("path is required")
    val method = request["method"] as? String
      ?: throw IllegalArgumentException("method is required")
    val pin = request["pin"] as? String
    if (pin == null && !(method == "POST" && isUnpinnedPairingPath(path))) {
      throw SecurityException("Unpinned requests are restricted to SRP pairing")
    }
    val trust = PinningTrustManager(pin)
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(trust), secureRandom)
    val socketFactory = PinningSocketFactory(context.socketFactory, trust)
    val connection = URL(origin + path).openConnection() as HttpsURLConnection
    onCreated(connection)
    connection.sslSocketFactory = socketFactory
    connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
    connection.requestMethod = method
    connection.connectTimeout = (request["timeoutMs"] as Number).toInt()
    connection.readTimeout = (request["timeoutMs"] as Number).toInt()
    @Suppress("UNCHECKED_CAST")
    (request["headers"] as? Map<String, String>).orEmpty().forEach {
      (name, value) -> connection.setRequestProperty(name, value)
    }
    val body = request["body"] as? String
    if (body != null) {
      connection.doOutput = true
      connection.outputStream.use {
        it.write(body.toByteArray(StandardCharsets.UTF_8))
      }
    }
    return connection
  }

  private class PinningTrustManager(
    private val expectedPin: String?,
  ) : X509TrustManager {
    @Volatile var presentedPin: String = ""
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
      throw SecurityException("Client certificates are not accepted")
    }
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
      val certificate = chain.firstOrNull()
        ?: throw SecurityException("The server did not present a certificate")
      presentedPin = encodeBase64Url(
        MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded),
      )
      if (expectedPin != null && !MessageDigest.isEqual(
          presentedPin.toByteArray(StandardCharsets.US_ASCII),
          expectedPin.toByteArray(StandardCharsets.US_ASCII)
        )) {
        throw SecurityException("The server certificate pin changed")
      }
    }
  }

  private class PinningSocketFactory(
    private val delegate: javax.net.ssl.SSLSocketFactory,
    private val trust: PinningTrustManager,
  ) : javax.net.ssl.SSLSocketFactory() {
    val presentedPin: String get() = trust.presentedPin
    override fun getDefaultCipherSuites() = delegate.defaultCipherSuites
    override fun getSupportedCipherSuites() = delegate.supportedCipherSuites
    override fun createSocket(s: java.net.Socket, h: String, p: Int, a: Boolean) =
      delegate.createSocket(s, h, p, a)
    override fun createSocket(h: String, p: Int) = delegate.createSocket(h, p)
    override fun createSocket(h: String, p: Int, l: java.net.InetAddress, lp: Int) =
      delegate.createSocket(h, p, l, lp)
    override fun createSocket(h: java.net.InetAddress, p: Int) = delegate.createSocket(h, p)
    override fun createSocket(h: java.net.InetAddress, p: Int, l: java.net.InetAddress, lp: Int) =
      delegate.createSocket(h, p, l, lp)
  }

  companion object {
    private fun decodeBase64Url(value: String): ByteArray =
      Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun encodeBase64Url(value: ByteArray): String =
      Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun leftPad(value: ByteArray, size: Int): ByteArray {
      require(value.size <= size) { "SRP value is too large" }
      return ByteArray(size - value.size) + value
    }

    private fun incrementNonce(value: ByteArray): ByteArray {
      require(value.size == 12) { "Invalid AES-GCM nonce" }
      val result = value.copyOf()
      var counter = 0L
      for (index in 8..11) {
        counter = (counter shl 8) or (result[index].toLong() and 0xffL)
      }
      require(counter < 0xffff_ffffL) { "AES-GCM nonce exhausted" }
      counter += 1L
      for (index in 11 downTo 8) {
        result[index] = (counter and 0xffL).toByte()
        counter = counter ushr 8
      }
      return result
    }

    private fun isUnpinnedPairingPath(path: String): Boolean =
      path == "/api/v3/pairing/sessions" ||
        Regex("^/api/v3/pairing/sessions/[0-9a-f]{32}/proof$").matches(path)
  }

  private class SrpContext(
    val client: SRP6ClientSession,
    val params: SRP6CryptoParams,
  ) {
    var key: ByteArray? = null
    var nonce: ByteArray? = null

    fun clear() {
      key?.fill(0)
      key = null
      nonce = null
    }
  }
}
