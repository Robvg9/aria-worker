package com.robvg9.rwhtbridge

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AriaAccessibilityService : AccessibilityService() {
    companion object {
        const val BRIDGE_PORT = 43817

        @Volatile
        var instance: AriaAccessibilityService? = null
            private set
    }

    private val approvedBrowsers = setOf(
        "com.android.chrome",
        "org.mozilla.firefox",
        "com.brave.browser",
        "com.opera.browser"
    )

    private val executor = Executors.newCachedThreadPool()
    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        startLocalBridge()
    }

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        stopLocalBridge()
        instance = null
        super.onDestroy()
    }

    fun observeRoot(): Map<String, Any?>? {
        val root = resolveApprovedBrowserRoot() ?: return null
        val packageName = root.packageName?.toString()
        return mapOf(
            "surface" to "android-browser",
            "packageName" to packageName,
            "root" to serializeNode(root, "0", 0)
        )
    }

    fun execute(action: Map<String, Any?>): Map<String, Any> {
        val root = resolveApprovedBrowserRoot() ?: return fail("no_active_window")
        val pkg = root.packageName?.toString() ?: return fail("unknown_package")
        if (!approvedBrowsers.contains(pkg)) return fail("browser_not_allowlisted")

        return when (val actionName = action["action"]?.toString() ?: return fail("action_required")) {
            "click" -> {
                val node = nodeByPath(root, action["nodeId"]?.toString() ?: return fail("node_required"))
                    ?: return fail("node_not_found")
                if (!node.isClickable) return fail("node_not_clickable")
                ok(node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            }
            "type" -> {
                val node = nodeByPath(root, action["nodeId"]?.toString() ?: return fail("node_required"))
                    ?: return fail("node_not_found")
                val text = action["text"]?.toString() ?: return fail("text_required")
                if (node.isPassword || ((node.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0)) {
                    if (text.matches(Regex("(?s).{0,0}"))) return fail("password_value_not_observed")
                }
                if (looksSecret(text)) return fail("secret_material_rejected")
                val args = Bundle().apply {
                    putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        text
                    )
                }
                ok(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args))
            }
            "press" -> {
                val code = (action["keyCode"] as? Number)?.toInt() ?: return fail("key_code_required")
                when (code) {
                    KeyEvent.KEYCODE_BACK -> ok(performGlobalAction(GLOBAL_ACTION_BACK))
                    KeyEvent.KEYCODE_ENTER -> {
                        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                            ?: return fail("focused_input_not_found")
                        if (android.os.Build.VERSION.SDK_INT >= 30) {
                            ok(focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id))
                        } else {
                            fail("enter_key_requires_api_30")
                        }
                    }
                    else -> fail("key_not_allowed")
                }
            }
            "scroll" -> {
                val node = nodeByPath(root, action["nodeId"]?.toString() ?: return fail("node_required"))
                    ?: return fail("node_not_found")
                val command = when (action["direction"]?.toString()) {
                    "forward" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    "backward" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                    else -> return fail("direction_invalid")
                }
                ok(node.performAction(command))
            }
            "navigate" -> navigate(action["url"]?.toString())
            "wait" -> {
                val ms = ((action["ms"] as? Number)?.toLong() ?: 500L).coerceIn(0L, 60_000L)
                try {
                    Thread.sleep(ms)
                    mapOf("ok" to true, "waited_ms" to ms)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    fail("wait_interrupted")
                }
            }
            else -> fail("unsupported_action")
        }
    }

    private fun resolveApprovedBrowserRoot(): AccessibilityNodeInfo? {
        val active = rootInActiveWindow
        if (active != null) {
            val pkg = active.packageName?.toString()
            if (pkg != null && approvedBrowsers.contains(pkg)) return active
        }

        val windows = windows ?: return null
        var best: AccessibilityNodeInfo? = null
        var bestLayer = Int.MIN_VALUE
        for (window in windows) {
            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            val candidate = window.root ?: continue
            val pkg = candidate.packageName?.toString() ?: continue
            if (!approvedBrowsers.contains(pkg)) continue
            if (best == null || window.layer > bestLayer) {
                best = candidate
                bestLayer = window.layer
            }
        }
        return best
    }

    private fun navigate(rawUrl: String?): Map<String, Any> {
        val url = rawUrl?.trim() ?: return fail("url_required")
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return fail("url_invalid")
        if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) {
            return fail("url_not_allowed")
        }
        val browserPackage = installedApprovedBrowser() ?: return fail("approved_browser_not_installed")
        return try {
            startActivity(
                Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(browserPackage)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            mapOf("ok" to true, "browserPackage" to browserPackage)
        } catch (_: Exception) {
            fail("navigation_failed")
        }
    }

    private fun installedApprovedBrowser(): String? {
        for (pkg in approvedBrowsers) {
            if (runCatching { packageManager.getPackageInfo(pkg, 0) }.isSuccess) return pkg
        }
        return null
    }

    private fun serializeNode(node: AccessibilityNodeInfo, path: String, depth: Int): Map<String, Any?> {
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        val sensitive = node.isPassword
        val children = ArrayList<Map<String, Any?>>()
        if (depth < 20) {
            for (i in 0 until node.childCount.coerceAtMost(80)) {
                val child = node.getChild(i) ?: continue
                children.add(serializeNode(child, "$path.$i", depth + 1))
            }
        }
        return mapOf(
            "id" to path,
            "role" to roleFor(node),
            "name" to node.contentDescription?.toString(),
            "text" to if (sensitive) null else node.text?.toString(),
            "label" to node.hintText?.toString(),
            "className" to node.className?.toString(),
            "packageName" to node.packageName?.toString(),
            "clickable" to node.isClickable,
            "enabled" to node.isEnabled,
            "visible" to node.isVisibleToUser,
            "focused" to node.isFocused,
            "scrollable" to node.isScrollable,
            "parent_id" to if (path == "0") null else path.substringBeforeLast('.'),
            "bounds" to mapOf(
                "left" to bounds.left,
                "top" to bounds.top,
                "right" to bounds.right,
                "bottom" to bounds.bottom
            )
        )
    }

    private fun nodeByPath(root: AccessibilityNodeInfo, path: String): AccessibilityNodeInfo? {
        if (path == "0") return root
        val parts = path.split('.')
        if (parts.firstOrNull() != "0") return null
        var current = root
        for (part in parts.drop(1)) {
            current = current.getChild(part.toIntOrNull() ?: return null) ?: return null
        }
        return current
    }

    private fun roleFor(node: AccessibilityNodeInfo): String {
        val cls = node.className?.toString()?.lowercase().orEmpty()
        return when {
            cls.contains("edittext") -> "textbox"
            cls.contains("button") -> "button"
            cls.contains("checkbox") -> "checkbox"
            cls.contains("radiobutton") -> "radio"
            cls.contains("switch") -> "switch"
            node.isClickable && !node.isScrollable -> "button"
            else -> "text"
        }
    }

    private fun looksSecret(value: String): Boolean =
        Regex("(?i)(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|Bearer\\s+[A-Za-z0-9._~-]{12,}|-----BEGIN .*PRIVATE KEY-----)")
            .containsMatchIn(value)

    private fun ok(success: Boolean): Map<String, Any> =
        if (success) mapOf("ok" to true) else fail("action_failed")

    private fun fail(reason: String): Map<String, Any> =
        mapOf("ok" to false, "reason" to reason)

    private fun startLocalBridge() {
        if (running) return
        running = true
        executor.execute {
            try {
                server = ServerSocket(BRIDGE_PORT, 8, InetAddress.getByName("127.0.0.1"))
                while (running) {
                    val socket = server?.accept() ?: break
                    socket.soTimeout = 10_000
                    executor.execute { handleClient(socket) }
                }
            } catch (_: Exception) {
                if (running) running = false
            }
        }
    }

    private fun stopLocalBridge() {
        running = false
        runCatching { server?.close() }
        server = null
        executor.shutdownNow()
        runCatching { executor.awaitTermination(2, TimeUnit.SECONDS) }
    }

    private fun handleClient(socket: Socket) {
        socket.use {
            try {
                val reader = BufferedReader(InputStreamReader(it.getInputStream(), StandardCharsets.UTF_8))
                val writer = BufferedWriter(OutputStreamWriter(it.getOutputStream(), StandardCharsets.UTF_8))
                val requestLine = reader.readLine() ?: return
                val headers = mutableMapOf<String,String>()
                var count = 0
                while (true) {
                    val line = reader.readLine() ?: return
                    if (line.isEmpty()) break
                    if (++count > 40) {
                        writeResponse(writer, 431, JSONObject(mapOf("ok" to false, "error" to "too_many_headers")))
                        return
                    }
                    val split = line.indexOf(':')
                    if (split > 0) headers[line.substring(0, split).trim().lowercase()] = line.substring(split + 1).trim()
                }

                val parts = requestLine.split(' ')
                if (parts.size < 2) {
                    writeResponse(writer, 400, JSONObject(mapOf("ok" to false, "error" to "bad_request")))
                    return
                }

                val method = parts[0].uppercase()
                val path = parts[1]
                val length = (headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, 65_536)
                val body = CharArray(length)
                var read = 0
                while (read < length) {
                    val n = reader.read(body, read, length - read)
                    if (n <= 0) break
                    read += n
                }

                when {
                    method == "GET" && path == "/v1/health" -> {
                        writeResponse(
                            writer, 200,
                            JSONObject(mapOf(
                                "ok" to true,
                                "state" to if (running) "ready" else "faulted",
                                "service_enabled" to true,
                                "bridge_port" to BRIDGE_PORT
                            ))
                        )
                    }
                    method == "GET" && path == "/v1/observe" -> {
                        val observed = observeRoot()
                        if (observed == null) {
                            writeResponse(writer, 409, JSONObject(mapOf("ok" to false, "error" to "no_active_browser_window")))
                        } else {
                            val payload = JSONObject(observed)
                            payload.put("ok", true)
                            payload.put("evidence_hash", evidenceHash(payload.toString()))
                            writeResponse(writer, 200, payload)
                        }
                    }
                    method == "POST" && path == "/v1/action" -> {
                        val bodyText = body.concatToString()
                        val payload: JSONObject? = try {
                            JSONObject(bodyText)
                        } catch (_: Exception) {
                            null
                        }
                        if (payload == null) {
                            writeResponse(writer, 400, JSONObject(mapOf("ok" to false, "error" to "invalid_json")))
                            return
                        }
                        val action = mutableMapOf<String, Any?>()
                        if (payload.has("action")) action["action"] = payload.optString("action")
                        if (payload.has("nodeId")) action["nodeId"] = payload.optString("nodeId")
                        if (payload.has("text")) action["text"] = payload.optString("text")
                        if (payload.has("keyCode")) action["keyCode"] = payload.optInt("keyCode")
                        if (payload.has("direction")) action["direction"] = payload.optString("direction")
                        if (payload.has("url")) action["url"] = payload.optString("url")
                        if (payload.has("ms")) action["ms"] = payload.optLong("ms")
                        val result = execute(action)
                        val out = JSONObject(result)
                        if (result["ok"] == true) {
                            val after = observeRoot()
                            if (after != null) {
                                out.put("ui", JSONObject(after))
                                out.put("evidence_hash", evidenceHash(out.toString()))
                            }
                        }
                        writeResponse(writer, if (result["ok"] == true) 200 else 409, out)
                    }
                    else -> writeResponse(writer, 404, JSONObject(mapOf("ok" to false, "error" to "not_found")))
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun evidenceHash(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun writeResponse(writer: BufferedWriter, status: Int, body: JSONObject) {
        val payload = body.toString()
        val bytes = payload.toByteArray(StandardCharsets.UTF_8).size
        writer.write("HTTP/1.1 " + status + " " + if (status == 200) "OK" else "Error" + "\r\n")
        writer.write("Content-Type: application/json; charset=utf-8\r\n")
        writer.write("Cache-Control: no-store\r\n")
        writer.write("Connection: close\r\n")
        writer.write("Content-Length: " + bytes + "\r\n\r\n")
        writer.write(payload)
        writer.flush()
    }
}
