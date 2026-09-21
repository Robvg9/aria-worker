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
    private val acceptExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val clientExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    @Volatile private var running = false
    @Volatile private var serverSocket: ServerSocket? = null

    fun start() {
        if (running) return
        running = true
        acceptExecutor.execute {
            try {
                ServerSocket().use { server ->
                    server.reuseAddress = true
                    server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), IpcAuth.PORT), 8)
                    serverSocket = server
                    while (running) {
                        val socket = try { server.accept() } catch (_: Exception) { break }
                        clientExecutor.execute { handleClient(socket) }
                    }
                }
            } catch (_: Exception) {
                running = false
            } finally { serverSocket = null }
        }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        acceptExecutor.shutdownNow()
        clientExecutor.shutdownNow()
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
                val lines = headerText.split("
")
                val requestLine = lines.firstOrNull().orEmpty().split(" ")
                val method = requestLine.getOrNull(0).orEmpty().uppercase(Locale.US)
                val path = requestLine.getOrNull(1).orEmpty()
                val headers = mutableMapOf<String, String>()
                for (line in lines.drop(1)) {
                    val idx = line.indexOf(":")
                    if (idx > 0) headers[line.substring(0, idx).trim().lowercase(Locale.US)] = line.substring(idx + 1).trim()
                }
                if (method != "POST" || path != IpcAuth.PATH) {
                    writeResponse(socket.getOutputStream(), 404, """{"ok":false,"reason":"route_not_found"}""")
                    return
                }
                if (headers["authorization"] != "Bearer " + IpcAuth.TOKEN) {
                    writeResponse(socket.getOutputStream(), 401, """{"ok":false,"reason":"unauthorized"}""")
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
        val head = "HTTP/1.1 " + status + " " + reason + "
" +
            "Content-Type: application/json; charset=utf-8
" +
            "Content-Length: " + bytes.size + "
" +
            "Connection: close

"
        output.write(head.toByteArray(StandardCharsets.US_ASCII))
        output.write(bytes)
        output.flush()
    }
}
