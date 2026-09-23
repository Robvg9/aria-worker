package com.robvg9.ariauiagent

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Local authenticated IPC bridge between Termux and the AccessibilityService. */
class LocalIpcServer(private val service: AriaAccessibilityService) {
    @Volatile private var running = false
    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var lastError: String? = null
    private var acceptExecutor: ExecutorService? = null
    private var clientExecutor: ExecutorService? = null

    /**
     * Bind synchronously before returning so onServiceConnected() never advertises
     * a service that has not actually opened the IPC socket yet.
     */
    @Synchronized
    fun start(): Boolean {
        if (isHealthy()) return true
        stop()
        val server = ServerSocket()
        return try {
            server.reuseAddress = true
            server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), IpcAuth.PORT), 8)
            serverSocket = server
            running = true
            lastError = null
            acceptExecutor = Executors.newSingleThreadExecutor()
            clientExecutor = Executors.newSingleThreadExecutor()
            acceptExecutor?.execute {
                try {
                    while (running && !server.isClosed) {
                        val socket = try {
                            server.accept()
                        } catch (_: Exception) {
                            if (running) {
                                lastError = "accept_failed"
                                running = false
                            }
                            break
                        }
                        clientExecutor?.execute { handleClient(socket) }
                    }
                } finally {
                    if (serverSocket === server) {
                        serverSocket = null
                    }
                }
            }
            true
        } catch (e: Exception) {
            running = false
            lastError = e.message?.replace(Regex("[^A-Za-z0-9._:-]"), "_")?.take(120) ?: "bind_failed"
            try { server.close() } catch (_: Exception) {}
            serverSocket = null
            acceptExecutor?.shutdownNow()
            clientExecutor?.shutdownNow()
            acceptExecutor = null
            clientExecutor = null
            false
        }
    }

    fun isHealthy(): Boolean {
        val server = serverSocket
        return running && server != null && server.isBound && !server.isClosed
    }

    fun healthJson(): String {
        val healthy = isHealthy()
        val uid = android.os.Process.myUid()
        val userId = uid / 100000
        val packageInfo = runCatching {
            service.packageManager.getPackageInfo(service.packageName, 0)
        }.getOrNull()
        val versionName = packageInfo?.versionName ?: "unknown"
        val versionCode = packageInfo?.longVersionCode ?: 0L
        val buildId = BuildConfig.ARIA_BUILD_ID
        val error = lastError?.let { ",\"last_error\":\"$it\"" } ?: ""
        return """{"ok":$healthy,"service":"aria-accessibility","port":${IpcAuth.PORT},"protocol":"${IpcAuth.HEALTH_PROTOCOL}","package":"${service.packageName}","uid":$uid,"user_id":$userId,"version_name":"$versionName","version_code":$versionCode,"build_id":"$buildId"$error}"""
    }

    @Synchronized
    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        acceptExecutor?.shutdownNow()
        clientExecutor?.shutdownNow()
        acceptExecutor = null
        clientExecutor = null
    }

    private fun handleClient(socket: Socket) {
        socket.use {
            try {
                socket.soTimeout = 8000
                val input = BufferedInputStream(socket.getInputStream())
                val headersBytes = ByteArrayOutputStream()
                var matched = 0
                while (headersBytes.size() <= 16384) {
                    val b = input.read()
                    if (b < 0) return
                    headersBytes.write(b)
                    matched = when {
                        matched == 0 && b == 13 -> 1
                        matched == 1 && b == 10 -> 2
                        matched == 2 && b == 13 -> 3
                        matched == 3 && b == 10 -> 4
                        b == 13 -> 1
                        else -> 0
                    }
                    if (matched == 4) break
                }
                if (matched != 4) {
                    writeResponse(socket.getOutputStream(), 400, """{"ok":false,"reason":"headers_invalid"}""")
                    return
                }

                val headerText = headersBytes.toString(StandardCharsets.UTF_8.name())
                val lines = headerText.split("\r\n")
                val requestLine = lines.firstOrNull().orEmpty().split(" ")
                val method = requestLine.getOrNull(0).orEmpty().uppercase(Locale.US)
                val path = requestLine.getOrNull(1).orEmpty()
                val headers = mutableMapOf<String, String>()

                for (line in lines.drop(1)) {
                    val idx = line.indexOf(":")
                    if (idx > 0) {
                        headers[line.substring(0, idx).trim().lowercase(Locale.US)] =
                            line.substring(idx + 1).trim()
                    }
                }

                val authorized = headers["authorization"] == "Bearer " + IpcAuth.TOKEN
                if (!authorized) {
                    writeResponse(socket.getOutputStream(), 401, """{"ok":false,"reason":"unauthorized"}""")
                    return
                }

                if (method == "GET" && path == IpcAuth.HEALTH_PATH) {
                    writeResponse(socket.getOutputStream(), 200, healthJson())
                    return
                }

                if (method != "POST" || path != IpcAuth.PATH) {
                    writeResponse(socket.getOutputStream(), 404, """{"ok":false,"reason":"route_not_found"}""")
                    return
                }

                val length = headers["content-length"]?.toIntOrNull()
                if (length == null || length <= 0 || length > 262144) {
                    writeResponse(socket.getOutputStream(), 413, """{"ok":false,"reason":"body_length_invalid"}""")
                    return
                }

                val body = ByteArray(length)
                var offset = 0
                while (offset < length) {
                    val count = input.read(body, offset, length - offset)
                    if (count <= 0) {
                        writeResponse(socket.getOutputStream(), 400, """{"ok":false,"reason":"body_incomplete"}""")
                        return
                    }
                    offset += count
                }

                val result = service.handle(String(body, StandardCharsets.UTF_8))
                writeResponse(socket.getOutputStream(), 200, result.toString())
            } catch (_: Exception) {
                try {
                    writeResponse(socket.getOutputStream(), 500, """{"ok":false,"reason":"ipc_server_error"}""")
                } catch (_: Exception) {}
            }
        }
    }

    private fun writeResponse(output: OutputStream, status: Int, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            413 -> "Payload Too Large"
            else -> "Internal Server Error"
        }
        val head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + bytes.size + "\r\n" +
            "Connection: close\r\n\r\n"
        output.write(head.toByteArray(StandardCharsets.US_ASCII))
        output.write(bytes)
        output.flush()
    }
}
