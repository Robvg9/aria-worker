package com.robvg9.ariauiagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors

class AriaAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile
        var instance: AriaAccessibilityService? = null
            private set
    }

    private val executor = Executors.newCachedThreadPool()
    private val approvedBrowsers = setOf(
        // Chrome family
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "com.google.android.apps.chrome",
        // Firefox family
        "org.mozilla.firefox",
        "org.mozilla.firefox_beta",
        "org.mozilla.focus",
        // Others commonly installed
        "com.brave.browser",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.microsoft.emmx",
        "com.sec.android.app.sbrowser",
        "com.android.browser"
    )

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_CLICKED or
                AccessibilityEvent.TYPE_VIEW_FOCUSED
            feedbackType = android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        instance = null
        executor.shutdownNow()
        super.onDestroy()
    }

    fun handle(payloadJson: String): JSONObject {
        return try {
            val payload = JSONObject(payloadJson)
            when (payload.optString("operation", "action")) {
                "observe" -> observeResponse()
                "action" -> actionResponse(payload.optJSONObject("action"))
                else -> error("operation_unsupported")
            }
        } catch (e: Exception) {
            error("invalid_request:" + (e.message ?: "unknown"))
        }
    }

    private fun observeResponse(): JSONObject {
        // Brief retry: windows list can lag right after activity switch.
        var root: AccessibilityNodeInfo? = null
        var lastDiag: JSONObject? = null
        repeat(3) { attempt ->
            val resolved = resolveApprovedBrowserRootWithDiag()
            root = resolved.first
            lastDiag = resolved.second
            if (root != null) return@repeat
            if (attempt < 2) Thread.sleep(120L)
        }
        if (root == null) {
            return error("no_active_browser_window").put("diagnostic", lastDiag ?: JSONObject())
        }
        val tree = serializeNode(root, "0", 0, NodeBudget())
        return JSONObject()
            .put("ok", true)
            .put("packageName", root.packageName?.toString())
            .put("root", tree)
            .put("evidence_hash", sha256(tree.toString()))
            .put("diagnostic", lastDiag)
    }

    private fun actionResponse(action: JSONObject?): JSONObject {
        if (action == null) return error("action_required")
        val result = executeAction(action)
        if (!result.optBoolean("ok", false)) return result

        Thread.sleep(250)
        val observed = resolveApprovedBrowserRoot() ?: return error("post_action_window_missing")
        val ui = serializeNode(observed, "0", 0, NodeBudget())
        return result
            .put("ui", JSONObject()
                .put("ok", true)
                .put("packageName", observed.packageName?.toString())
                .put("root", ui)
                .put("evidence_hash", sha256(ui.toString())))
            .put("evidence_hash", sha256(result.toString() + ui.toString()))
    }

    private fun executeAction(action: JSONObject): JSONObject {
        return when (action.optString("action")) {
            "click" -> {
                val root = resolveApprovedBrowserRoot() ?: return error("no_active_browser_window")
                val node = nodeByPath(root, action.optString("nodeId")) ?: return error("node_not_found")
                val clicked = node.isEnabled && (node.performAction(AccessibilityNodeInfo.ACTION_CLICK) || gestureClick(node))
                ok(clicked, if (clicked) null else "click_failed")
            }
            "type" -> {
                val root = resolveApprovedBrowserRoot() ?: return error("no_active_browser_window")
                val node = nodeByPath(root, action.optString("nodeId")) ?: return error("node_not_found")
                val text = action.optString("text", "")
                if (node.isPassword || ((node.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0)) {
                    if (text.isEmpty()) return error("password_empty")
                }
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                }
                ok(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args), "type_failed")
            }
            "press" -> {
                when (action.optInt("keyCode", -1)) {
                    KeyEvent.KEYCODE_BACK -> ok(performGlobalAction(GLOBAL_ACTION_BACK), "back_failed")
                    KeyEvent.KEYCODE_ENTER -> {
                        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return error("focused_input_not_found")
                        if (android.os.Build.VERSION.SDK_INT >= 30) {
                            ok(focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id), "enter_failed")
                        } else {
                            error("enter_not_supported")
                        }
                    }
                    else -> error("key_not_allowed")
                }
            }
            "scroll" -> {
                val root = resolveApprovedBrowserRoot() ?: return error("no_active_browser_window")
                val node = nodeByPath(root, action.optString("nodeId")) ?: return error("node_not_found")
                val command = if (action.optString("direction", "forward") == "backward") {
                    AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                } else {
                    AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                }
                ok(node.performAction(command), "scroll_failed")
            }
            "navigate" -> navigate(action.optString("url"))
            "wait" -> {
                val ms = action.optLong("ms", 500L).coerceIn(0L, 5000L)
                Thread.sleep(ms)
                ok(true)
            }
            else -> error("unsupported_action")
        }
    }

    private fun navigate(url: String): JSONObject {
        val value = url.trim()
        val uri = runCatching { android.net.Uri.parse(value) }.getOrNull()
            ?: return error("url_invalid")
        if (uri.scheme !in setOf("http", "https")) return error("url_scheme_not_allowed")
        if (uri.host != "aria.robvg9.workers.dev") return error("url_host_not_allowed")
        val browser = approvedBrowsers.firstOrNull {
            runCatching { packageManager.getPackageInfo(it, 0) }.isSuccess
        } ?: return error("approved_browser_not_installed")
        return try {
            startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri).apply {
                setPackage(browser)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            ok(true)
        } catch (_: Exception) {
            error("navigation_failed")
        }
    }

    private fun resolveApprovedBrowserRoot(): AccessibilityNodeInfo? =
        resolveApprovedBrowserRootWithDiag().first

    private fun resolveApprovedBrowserRootWithDiag(): Pair<AccessibilityNodeInfo?, JSONObject> {
        val diag = JSONObject()
        val active = rootInActiveWindow
        val activePackage = active?.packageName?.toString()
        diag.put("activePackage", activePackage)
        diag.put("activeIsBrowser", activePackage != null && approvedBrowsers.contains(activePackage))
        diag.put("approvedBrowsers", JSONArray(approvedBrowsers.toList()))

        val installed = JSONArray()
        for (pkg in approvedBrowsers) {
            if (runCatching { packageManager.getPackageInfo(pkg, 0) }.isSuccess) {
                installed.put(pkg)
            }
        }
        diag.put("installedApprovedBrowsers", installed)

        if (active != null && activePackage != null && approvedBrowsers.contains(activePackage)) {
            diag.put("source", "rootInActiveWindow")
            return Pair(active, diag)
        }

        val currentWindows = windows
        if (currentWindows == null) {
            diag.put("windowsNull", true)
            diag.put("hint", "windows_null_ensure_FLAG_RETRIEVE_INTERACTIVE_WINDOWS_and_toggle_service")
            return Pair(null, diag)
        }

        diag.put("windowsNull", false)
        diag.put("windowCount", currentWindows.size)
        val windowRows = JSONArray()
        var best: AccessibilityNodeInfo? = null
        var bestLayer = Int.MIN_VALUE

        for (window in currentWindows) {
            val row = JSONObject()
            row.put("type", window.type)
            row.put("layer", window.layer)
            row.put("id", window.id)
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                row.put("isActive", window.isActive)
                row.put("isFocused", window.isFocused)
            }
            val candidate = try { window.root } catch (_: Exception) { null }
            row.put("hasRoot", candidate != null)
            val pkg = candidate?.packageName?.toString()
            row.put("packageName", pkg)
            row.put("isApprovedBrowser", pkg != null && approvedBrowsers.contains(pkg))
            windowRows.put(row)

            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            if (candidate == null) continue
            if (pkg == null || !approvedBrowsers.contains(pkg)) continue
            if (best == null || window.layer > bestLayer) {
                best = candidate
                bestLayer = window.layer
            }
        }

        var appWindows = 0
        var appWindowsWithRoot = 0
        for (window in currentWindows) {
            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            appWindows += 1
            val r = try { window.root } catch (_: Exception) { null }
            if (r != null) appWindowsWithRoot += 1
        }
        diag.put("applicationWindowCount", appWindows)
        diag.put("applicationWindowsWithRoot", appWindowsWithRoot)
        diag.put("windows", windowRows)

        if (best != null) {
            diag.put("source", "windows_scan")
            diag.put("selectedPackage", best.packageName?.toString())
            return Pair(best, diag)
        }

        if (installed.length() == 0) {
            diag.put("hint", "no_approved_browser_installed")
        } else if (appWindowsWithRoot == 0 && appWindows > 0) {
            diag.put("hint", "application_windows_present_but_roots_null_oem_or_toggle_service")
        } else if (activePackage != null && !approvedBrowsers.contains(activePackage)) {
            diag.put(
                "hint",
                "foreground_is_not_browser_open_chrome_then_keep_it_in_recents_before_observe"
            )
        } else {
            diag.put("hint", "no_browser_window_with_retrievable_root")
        }
        return Pair(null, diag)
    }

    private data class NodeBudget(var count: Int = 0, val maxCount: Int = 700)

    private fun serializeNode(node: AccessibilityNodeInfo, path: String, depth: Int, budget: NodeBudget): JSONObject {
        if (budget.count >= budget.maxCount) {
            return JSONObject().put("id", path).put("role", "text").put("text", "[node_limit]")
        }
        budget.count += 1
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        val obj = JSONObject()
            .put("id", path)
            .put("role", roleFor(node))
            .put("name", truncate(node.contentDescription?.toString(), 300))
            .put("text", if (node.isPassword) null else truncate(node.text?.toString(), 500))
            .put("label", truncate(node.hintText?.toString(), 300))
            .put("className", node.className?.toString())
            .put("packageName", node.packageName?.toString())
            .put("clickable", node.isClickable)
            .put("enabled", node.isEnabled)
            .put("visible", node.isVisibleToUser)
            .put("focused", node.isFocused)
            .put("scrollable", node.isScrollable)
            .put("bounds", JSONObject()
                .put("left", bounds.left)
                .put("top", bounds.top)
                .put("right", bounds.right)
                .put("bottom", bounds.bottom))
            .put("children", JSONArray())

        val children = obj.getJSONArray("children")
        if (depth < 24 && budget.count < budget.maxCount) {
            for (i in 0 until node.childCount.coerceAtMost(80)) {
                val child = node.getChild(i) ?: continue
                try {
                    children.put(serializeNode(child, "$path.$i", depth + 1, budget))
                } finally {
                    child.recycle()
                }
                if (budget.count >= budget.maxCount) break
            }
        }
        return obj
    }

    private fun nodeByPath(root: AccessibilityNodeInfo, path: String): AccessibilityNodeInfo? {
        if (path == "0") return root
        val parts = path.split('.')
        if (parts.firstOrNull() != "0") return null
        var current = root
        for (part in parts.drop(1)) {
            val index = part.toIntOrNull() ?: return null
            current = current.getChild(index) ?: return null
        }
        return current
    }

    private fun gestureClick(node: AccessibilityNodeInfo): Boolean {
        if (!node.isVisibleToUser || android.os.Build.VERSION.SDK_INT < 24) return false
        val rect = Rect().also { node.getBoundsInScreen(it) }
        if (rect.isEmpty) return false
        val path = Path().apply { moveTo(rect.exactCenterX(), rect.exactCenterY()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 80L))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun roleFor(node: AccessibilityNodeInfo): String {
        val cls = node.className?.toString()?.lowercase().orEmpty()
        return when {
            cls.contains("edittext") -> "textbox"
            cls.contains("button") -> "button"
            cls.contains("checkbox") -> "checkbox"
            cls.contains("radiobutton") -> "radio"
            cls.contains("switch") -> "switch"
            node.isScrollable -> "scrollable"
            node.isClickable -> "button"
            else -> "text"
        }
    }

    private fun ok(value: Boolean, reason: String? = null): JSONObject =
        JSONObject().put("ok", value).apply { if (!value && reason != null) put("reason", reason) }

    private fun error(reason: String): JSONObject =
        JSONObject().put("ok", false).put("reason", reason)

    private fun truncate(value: String?, max: Int): String? {
        if (value == null) return null
        return if (value.length <= max) value else value.take(max) + "…"
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
