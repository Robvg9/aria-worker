package com.robvg9.ariauiagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class AriaAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile var instance: AriaAccessibilityService? = null
            private set
        private const val OWN_PKG_PREFIX = "com.robvg9.ariauiagent"
    }

    private val executor = Executors.newCachedThreadPool()
    private var localIpcServer: LocalIpcServer? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val approvedBrowsers = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
        "com.google.android.apps.chrome", "org.mozilla.firefox", "org.mozilla.firefox_beta",
        "org.mozilla.focus", "com.brave.browser", "com.opera.browser", "com.opera.mini.native",
        "com.microsoft.emmx", "com.sec.android.app.sbrowser", "com.android.browser"
    )

    private var overlayView: View? = null
    private var overlayPanel: LinearLayout? = null
    private var overlayStatus: TextView? = null
    private var overlayCollapsed: Boolean = false
    private var overlayParams: WindowManager.LayoutParams? = null

    private data class ObserveCapture(
        val packageName: String, val tree: JSONObject, val evidenceHash: String,
        val diagnostic: JSONObject, val capturedAtElapsedMs: Long
    )

    @Volatile private var pendingCapture: ObserveCapture? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        localIpcServer = LocalIpcServer(this).also { it.start() }
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_CLICKED or AccessibilityEvent.TYPE_VIEW_FOCUSED
            feedbackType = android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        hideObserveOverlay()
        localIpcServer?.stop()
        localIpcServer = null
        instance = null
        executor.shutdownNow()
        super.onDestroy()
    }

    fun showObserveOverlay() {
        mainHandler.post {
            if (overlayView != null) {
                expandOverlayUi()
                overlayStatus?.text = "ESPERANDO\nChrome → OBSERVAR"
                return@post
            }
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            val safeTop = systemSafeTopInsetPx(wm)
            val density = resources.displayMetrics.density
            val panelWidth = (168 * density).toInt()
            val panel = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
                setBackgroundColor(Color.argb(235, 12, 40, 28))
            }
            overlayPanel = panel
            val title = TextView(this).apply {
                text = "ARIA ▾"
                setTextColor(Color.WHITE)
                textSize = 12f
                setPadding(0, 0, 0, 4)
                setOnClickListener { toggleOverlayCollapsed() }
            }
            val status = TextView(this).apply {
                text = "ESPERANDO\nChrome → OBSERVAR"
                setTextColor(Color.rgb(180, 255, 210))
                textSize = 11f
                setPadding(0, 0, 0, 6)
            }
            overlayStatus = status
            val btnObserve = Button(this).apply {
                text = "OBSERVAR"
                textSize = 13f
                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { captureObserveOnDown(); true }
                        MotionEvent.ACTION_UP -> { commitObserveAfterDown(); true }
                        MotionEvent.ACTION_CANCEL -> { pendingCapture = null; true }
                        else -> false
                    }
                }
            }
            val btnClose = Button(this).apply {
                text = "Cerrar"
                textSize = 11f
                setOnClickListener {
                    LocalMissionRunner.active?.exitWaitingObserve()
                    hideObserveOverlay()
                }
            }
            panel.addView(title); panel.addView(status); panel.addView(btnObserve); panel.addView(btnClose)
            attachPanelDrag(panel, title)
            val params = WindowManager.LayoutParams(
                panelWidth, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = (8 * density).toInt()
                y = safeTop + (8 * density).toInt()
            }
            overlayParams = params
            params.y = params.y.coerceAtLeast(safeTop)
            try {
                wm.addView(panel, params)
                overlayView = panel
                overlayCollapsed = false
            } catch (_: Exception) {
                overlayView = null; overlayStatus = null; overlayPanel = null; overlayParams = null
            }
        }
    }

    private fun toggleOverlayCollapsed() {
        val panel = overlayPanel ?: return
        overlayCollapsed = !overlayCollapsed
        val density = resources.displayMetrics.density
        if (overlayCollapsed) {
            for (i in 1 until panel.childCount) panel.getChildAt(i).visibility = View.GONE
            (panel.getChildAt(0) as? TextView)?.text = "ARIA ▸"
            panel.setPadding((10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt(), (8 * density).toInt())
        } else expandOverlayUi()
    }

    private fun expandOverlayUi() {
        val panel = overlayPanel ?: return
        overlayCollapsed = false
        for (i in 0 until panel.childCount) panel.getChildAt(i).visibility = View.VISIBLE
        (panel.getChildAt(0) as? TextView)?.text = "ARIA ▾"
        val density = resources.displayMetrics.density
        panel.setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
    }

    private fun attachPanelDrag(panel: LinearLayout, handle: View) {
        var downRawX = 0f; var downRawY = 0f; var startX = 0; var startY = 0
        handle.setOnTouchListener { _, event ->
            val params = overlayParams ?: return@setOnTouchListener false
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX; downRawY = event.rawY; startX = params.x; startY = params.y; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downRawX).toInt()
                    val dy = (event.rawY - downRawY).toInt()
                    params.x = (startX - dx).coerceAtLeast(0)
                    val safeTop = systemSafeTopInsetPx(wm)
                    val safeBottom = systemSafeBottomInsetPx(wm)
                    val screenH = if (Build.VERSION.SDK_INT >= 30) {
                        wm.currentWindowMetrics.bounds.height()
                    } else {
                        @Suppress("DEPRECATION")
                        val h = wm.defaultDisplay.height
                        h
                    }
                    val maxY = (screenH - safeBottom - panel.height).coerceAtLeast(safeTop)
                    params.y = (startY + dy).coerceIn(safeTop, maxY)
                    try { wm.updateViewLayout(panel, params) } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (kotlin.math.abs(event.rawX - downRawX) < 12 && kotlin.math.abs(event.rawY - downRawY) < 12) {
                        toggleOverlayCollapsed()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun captureObserveOnDown() {
        pendingCapture = null
        overlayStatus?.text = "Capturando…"
        val (root, diag) = resolveApprovedBrowserRootWithDiag(preferWindowsScan = true)
        if (root == null) {
            pendingCapture = null
            overlayStatus?.text = "Sin Chrome en windows[]"
            return
        }
        val pkg = root.packageName?.toString() ?: "unknown"
        val tree = serializeNode(root, "0", 0, NodeBudget())
        val hash = sha256(tree.toString())
        diag.put("capturePhase", "action_down")
        diag.put("capturedPackage", pkg)
        pendingCapture = ObserveCapture(pkg, tree, hash, diag, SystemClock.elapsedRealtime())
        overlayStatus?.text = "Capturado\n$pkg"
    }

    private fun commitObserveAfterDown() {
        val cap = pendingCapture ?: run {
            overlayStatus?.text = "✗ Sin captura\nMantén Chrome visible"
            return
        }
        pendingCapture = null
        overlayStatus?.text = "Guardando…"
        executor.execute {
            val runner = LocalMissionRunner.active
            if (runner == null) {
                mainHandler.post { overlayStatus?.text = "✗ Runner no activo\nAbre ARIA UI" }
                return@execute
            }
            val result = try {
                runner.commitOverlayObserve(cap.packageName, cap.tree, cap.evidenceHash, cap.diagnostic)
            } catch (e: Exception) {
                mainHandler.post { overlayStatus?.text = "✗ ${e.message?.take(48)}" }
                return@execute
            }
            mainHandler.post {
                val ok = result.steps.asReversed().firstOrNull { it.kind == StepKind.OBSERVE }?.observation?.ok == true
                if (ok) {
                    overlayStatus?.text = "✓ ${cap.packageName}\nVolver a ARIA → Proponer"
                    if (!overlayCollapsed) toggleOverlayCollapsed()
                } else {
                    overlayStatus?.text = "✗ ${result.lastError?.take(56) ?: "observe falló"}"
                }
            }
        }
    }

    fun hideObserveOverlay() {
        mainHandler.post {
            val view = overlayView ?: return@post
            try { (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view) } catch (_: Exception) {}
            overlayView = null; overlayStatus = null; overlayPanel = null; overlayParams = null
            pendingCapture = null; overlayCollapsed = false
        }
    }

    private fun systemSafeTopInsetPx(wm: WindowManager): Int {
        return try {
            if (Build.VERSION.SDK_INT >= 30) {
                wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(
                    WindowInsets.Type.statusBars() or WindowInsets.Type.displayCutout()
                ).top
            } else {
                @Suppress("DEPRECATION")
                val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
                if (resId > 0) resources.getDimensionPixelSize(resId) else 0
            }
        } catch (_: Exception) {
            0
        }
    }

    private fun systemSafeBottomInsetPx(wm: WindowManager): Int {
        return try {
            if (Build.VERSION.SDK_INT >= 30) {
                wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(
                    WindowInsets.Type.navigationBars() or WindowInsets.Type.displayCutout()
                ).bottom
            } else {
                0
            }
        } catch (_: Exception) {
            0
        }
    }

    fun handle(payloadJson: String): JSONObject {
        return try {
            val payload = JSONObject(payloadJson)
            val targetPackage = payload.optString("target_package").trim().ifEmpty { null }
            val allowAnyApp = payload.optBoolean("allow_any_app", false)
            when (payload.optString("operation", "action")) {
                "observe" -> observeResponse(targetPackage, allowAnyApp)
                "action" -> actionResponse(
                    payload.optJSONObject("action"),
                    targetPackage,
                    allowAnyApp,
                    allowedHosts(payload.optJSONArray("allowed_hosts"))
                )
                else -> error("operation_unsupported")
            }
        } catch (e: Exception) {
            error("invalid_request:" + (e.message ?: "unknown"))
        }
    }

    private fun resolveBrowserWithRetries(
        attempts: Int, delayMs: Long, preferWindowsScan: Boolean, phase: String
    ): Pair<AccessibilityNodeInfo?, JSONObject> {
        var lastDiag = JSONObject()
        for (attempt in 0 until attempts) {
            val resolved = resolveApprovedBrowserRootWithDiag(preferWindowsScan = preferWindowsScan, phase = phase)
            lastDiag = resolved.second
            lastDiag.put("resolveAttempt", attempt + 1)
            lastDiag.put("resolveAttemptsMax", attempts)
            lastDiag.put("resolvePhase", phase)
            if (resolved.first != null) return resolved
            if (attempt < attempts - 1) Thread.sleep(delayMs)
        }
        lastDiag.put("hint", lastDiag.optString("hint", "") + "|post_retries_exhausted_no_approved_browser_window")
        return Pair(null, lastDiag)
    }

    private fun resolveTargetWithRetries(
        targetPackage: String,
        allowAnyApp: Boolean,
        attempts: Int,
        delayMs: Long,
        preferWindowsScan: Boolean,
        phase: String
    ): Pair<AccessibilityNodeInfo?, JSONObject> {
        var lastDiag = JSONObject()
        for (attempt in 0 until attempts) {
            val resolved = resolveTargetRootWithDiag(
                targetPackage = targetPackage,
                allowAnyApp = allowAnyApp,
                preferWindowsScan = preferWindowsScan,
                phase = phase
            )
            lastDiag = resolved.second.put("resolveAttempt", attempt + 1).put("resolveAttemptsMax", attempts)
            if (resolved.first != null) return resolved
            if (attempt < attempts - 1) Thread.sleep(delayMs)
        }
        return Pair(null, lastDiag.put("hint", lastDiag.optString("hint", "") + "|target_retries_exhausted"))
    }

    private fun allowedHosts(array: JSONArray?): Set<String> {
        val result = linkedSetOf<String>()
        if (array != null) {
            for (i in 0 until array.length()) {
                val host = array.optString(i).trim().lowercase()
                if (host.isNotBlank()) result.add(host)
            }
        }
        return result
    }

    private fun observeResponse(targetPackage: String?, allowAnyApp: Boolean): JSONObject {
        val (root, lastDiag) = if (targetPackage.isNullOrBlank() || approvedBrowsers.contains(targetPackage)) {
            resolveBrowserWithRetries(12, 200L, true, "observe")
        } else {
            resolveTargetWithRetries(targetPackage, allowAnyApp, 12, 200L, true, "observe")
        }
        if (root == null) return error("no_active_application_window").put("diagnostic", lastDiag)
        refreshAccessibilityRoot(root)
        val tree = serializeNode(root, "0", 0, NodeBudget())
        return JSONObject()
            .put("ok", true)
            .put("packageName", root.packageName?.toString())
            .put("root", tree)
            .put("evidence_hash", sha256(tree.toString()))
            .put("diagnostic", lastDiag)
    }

    private fun actionResponse(
        action: JSONObject?,
        targetPackage: String?,
        allowAnyApp: Boolean,
        allowedHosts: Set<String>
    ): JSONObject {
        if (action == null) return error("action_required")
        val result = executeAction(action, targetPackage, allowAnyApp, allowedHosts)
        if (!result.optBoolean("ok", false)) return result
        Thread.sleep(250)
        val (observed, diag) = if (targetPackage.isNullOrBlank() || approvedBrowsers.contains(targetPackage)) {
            resolveBrowserWithRetries(12, 200L, true, "post_action")
        } else {
            resolveTargetWithRetries(targetPackage, allowAnyApp, 12, 200L, true, "post_action")
        }
        if (observed == null) return error("post_action_window_missing").put("diagnostic", diag)
        refreshAccessibilityRoot(observed)
        val ui = serializeNode(observed, "0", 0, NodeBudget())
        return result
            .put("ui", JSONObject()
                .put("ok", true)
                .put("packageName", observed.packageName?.toString())
                .put("root", ui)
                .put("evidence_hash", sha256(ui.toString())))
            .put("evidence_hash", sha256(result.toString() + ui.toString()))
            .put("diagnostic", diag)
    }

    private fun executeAction(
        action: JSONObject,
        targetPackage: String?,
        allowAnyApp: Boolean,
        allowedHosts: Set<String>
    ): JSONObject {
        return when (action.optString("action")) {
            "click" -> {
                val root = resolveTargetRoot(targetPackage, allowAnyApp) ?: return error("no_active_application_window")
                refreshAccessibilityRoot(root)
                val node = nodeByPath(root, action.optString("nodeId")) ?: return error("node_not_found")
                if (!node.isEnabled || !node.isVisibleToUser) return error("click_target_not_actionable")
                val beforeTree = serializeNode(root, "0", 0, NodeBudget())
                val beforeHash = sha256(beforeTree.toString())
                val browserTarget = targetPackage?.let { approvedBrowsers.contains(it) } == true
                // Chrome/WebView accessibility nodes can block inside ACTION_CLICK. For approved
                // browsers, use the bounded gesture path first; it waits for the real gesture
                // completion callback and still falls back to ACTION_CLICK if needed.
                val clicked = if (browserTarget) {
                    gestureClick(node) || node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                } else {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK) || gestureClick(node)
                }
                if (!clicked) return error("click_failed")
                Thread.sleep(300)
                val afterRoot = resolveTargetRoot(targetPackage, allowAnyApp) ?: return error("post_action_window_missing")
                refreshAccessibilityRoot(afterRoot)
                val afterTree = serializeNode(afterRoot, "0", 0, NodeBudget())
                val afterHash = sha256(afterTree.toString())
                if (beforeHash == afterHash) {
                    return error("android_action_no_visible_state_change")
                        .put("before_hash", beforeHash)
                        .put("after_hash", afterHash)
                }
                ok(true)
                    .put("before_hash", beforeHash)
                    .put("after_hash", afterHash)
            }
            "type" -> {
                val root = resolveTargetRoot(targetPackage, allowAnyApp) ?: return error("no_active_application_window")
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
                        if (Build.VERSION.SDK_INT >= 30) {
                            ok(focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id), "enter_failed")
                        } else {
                            error("enter_not_supported")
                        }
                    }
                    else -> error("key_not_allowed")
                }
            }
            "scroll" -> {
                val root = resolveTargetRoot(targetPackage, allowAnyApp) ?: return error("no_active_application_window")
                val node = nodeByPath(root, action.optString("nodeId")) ?: return error("node_not_found")
                val command = if (action.optString("direction", "forward") == "backward") {
                    AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                } else {
                    AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                }
                ok(node.performAction(command), "scroll_failed")
            }
            "navigate" -> navigate(action.optString("url"), allowedHosts)
            "launch_app" -> launchApp(targetPackage)
            "swipe" -> gestureSwipe(
                action.optDouble("x1"),
                action.optDouble("y1"),
                action.optDouble("x2"),
                action.optDouble("y2"),
                action.optLong("durationMs", 500L)
            )
            "wait" -> {
                Thread.sleep(action.optLong("ms", 500L).coerceIn(0L, 5000L))
                ok(true)
            }
            else -> error("unsupported_action")
        }
    }

    private fun launchApp(targetPackage: String?): JSONObject {
        val pkg = targetPackage?.trim().orEmpty()
        if (pkg.isBlank()) return error("target_package_required")
        if (pkg.startsWith(OWN_PKG_PREFIX)) return error("target_package_blocked")
        val launchIntent = runCatching { packageManager.getLaunchIntentForPackage(pkg) }.getOrNull()
            ?: return error("launch_intent_not_found")
        return try {
            launchIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(launchIntent)
            ok(true)
        } catch (_: Exception) {
            error("launch_failed")
        }
    }

    private fun navigate(url: String, allowedHosts: Set<String>): JSONObject {
        val value = url.trim()
        val uri = runCatching { android.net.Uri.parse(value) }.getOrNull() ?: return error("url_invalid")
        if (uri.scheme !in setOf("http", "https")) return error("url_scheme_not_allowed")
        val host = uri.host?.lowercase().orEmpty()
        val allowed = if (allowedHosts.isNotEmpty()) {
            allowedHosts.any { it == host }
        } else {
            host == "aria.robvg9.workers.dev"
        }
        if (!allowed) return error("url_host_not_allowed")
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

    private fun resolveTargetRoot(
        targetPackage: String?,
        allowAnyApp: Boolean
    ): AccessibilityNodeInfo? =
        resolveTargetRootWithDiag(targetPackage, allowAnyApp, false, "action").first

    private fun resolveTargetRootWithDiag(
        targetPackage: String?,
        allowAnyApp: Boolean,
        preferWindowsScan: Boolean,
        phase: String
    ): Pair<AccessibilityNodeInfo?, JSONObject> {
        if (!targetPackage.isNullOrBlank() && !approvedBrowsers.contains(targetPackage) && !allowAnyApp) {
            return Pair(null, JSONObject().put("targetPackage", targetPackage).put("reason", "target_package_not_approved"))
        }
        if (targetPackage.isNullOrBlank() || approvedBrowsers.contains(targetPackage)) {
            return resolveApprovedBrowserRootWithDiag(preferWindowsScan, phase)
        }
        return resolveAnyApplicationRootWithDiag(targetPackage, preferWindowsScan, phase)
    }

    private fun resolveApprovedBrowserRootWithDiag(
        preferWindowsScan: Boolean,
        phase: String = "observe"
    ): Pair<AccessibilityNodeInfo?, JSONObject> {
        val diag = JSONObject()
        val active = rootInActiveWindow
        val activePackage = active?.packageName?.toString()
        val activeIsOwn = activePackage?.startsWith(OWN_PKG_PREFIX) == true
        diag.put("activePackage", activePackage)
        diag.put("resolvePhase", phase)
        diag.put("activeIsBrowser", activePackage != null && approvedBrowsers.contains(activePackage))
        diag.put("activeIsOwnApp", activeIsOwn)
        diag.put("preferWindowsScan", preferWindowsScan)
        val installed = JSONArray()
        for (pkg in approvedBrowsers) {
            if (runCatching { packageManager.getPackageInfo(pkg, 0) }.isSuccess) installed.put(pkg)
        }
        diag.put("installedApprovedBrowsers", installed)
        if (!preferWindowsScan && active != null && activePackage != null && !activeIsOwn && approvedBrowsers.contains(activePackage)) {
            diag.put("source", "rootInActiveWindow")
            appendWindowsDiag(diag)
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
        var bestActive = false
        for (window in currentWindows) {
            val row = JSONObject()
            row.put("type", window.type)
            row.put("layer", window.layer)
            row.put("id", window.id)
            if (Build.VERSION.SDK_INT >= 21) {
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
            val isActiveWin = Build.VERSION.SDK_INT >= 21 && window.isActive
            if (best == null || (isActiveWin && !bestActive) || (isActiveWin == bestActive && window.layer > bestLayer)) {
                best = candidate; bestLayer = window.layer; bestActive = isActiveWin
            }
        }
        var appWindows = 0; var appWindowsWithRoot = 0
        for (window in currentWindows) {
            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            appWindows += 1
            if (try { window.root } catch (_: Exception) { null } != null) appWindowsWithRoot += 1
        }
        diag.put("applicationWindowCount", appWindows)
        diag.put("applicationWindowsWithRoot", appWindowsWithRoot)
        diag.put("windows", windowRows)
        if (best != null) {
            diag.put("source", "windows_scan")
            diag.put("selectedPackage", best.packageName?.toString())
            return Pair(best, diag)
        }
        if (installed.length() == 0) diag.put("hint", "no_approved_browser_installed")
        else if (appWindowsWithRoot == 0 && appWindows > 0) diag.put("hint", "application_windows_present_but_roots_null_oem_or_toggle_service")
        else if (activeIsOwn || (activePackage != null && !approvedBrowsers.contains(activePackage)))
            diag.put("hint", "foreground_is_not_browser_capture_on_action_down_while_chrome_visible")
        else diag.put("hint", "no_browser_window_with_retrievable_root")
        return Pair(null, diag)
    }

    private fun resolveAnyApplicationRootWithDiag(
        targetPackage: String,
        preferWindowsScan: Boolean,
        phase: String
    ): Pair<AccessibilityNodeInfo?, JSONObject> {
        val diag = JSONObject()
            .put("targetPackage", targetPackage)
            .put("resolvePhase", phase)
            .put("preferWindowsScan", preferWindowsScan)

        fun blockedPackage(pkg: String?): Boolean {
            if (pkg.isNullOrBlank()) return true
            if (pkg.startsWith(OWN_PKG_PREFIX)) return true
            return pkg == "com.android.systemui" ||
                pkg == "com.android.settings" ||
                pkg == "com.google.android.permissioncontroller" ||
                pkg == "com.android.packageinstaller" ||
                pkg == "com.android.documentsui"
        }

        val active = rootInActiveWindow
        val activePackage = active?.packageName?.toString()
        diag.put("activePackage", activePackage)
        if (!preferWindowsScan && active != null && activePackage == targetPackage && !blockedPackage(activePackage)) {
            diag.put("source", "rootInActiveWindow")
            appendWindowsDiag(diag)
            return Pair(active, diag)
        }

        val currentWindows = windows
        if (currentWindows == null) {
            return Pair(null, diag.put("windowsNull", true).put("reason", "windows_null"))
        }

        var best: AccessibilityNodeInfo? = null
        var bestLayer = Int.MIN_VALUE
        var bestActive = false
        val rows = JSONArray()
        for (window in currentWindows) {
            val row = JSONObject()
            row.put("type", window.type)
            row.put("layer", window.layer)
            row.put("id", window.id)
            if (Build.VERSION.SDK_INT >= 21) {
                row.put("isActive", window.isActive)
                row.put("isFocused", window.isFocused)
            }
            val candidate = try { window.root } catch (_: Exception) { null }
            row.put("hasRoot", candidate != null)
            val pkg = candidate?.packageName?.toString()
            row.put("packageName", pkg)
            val matches = window.type == AccessibilityWindowInfo.TYPE_APPLICATION &&
                candidate != null &&
                pkg == targetPackage &&
                !blockedPackage(pkg)
            row.put("targetMatch", matches)
            rows.put(row)
            if (!matches) continue
            val isActiveWin = Build.VERSION.SDK_INT >= 21 && window.isActive
            if (best == null || (isActiveWin && !bestActive) || (isActiveWin == bestActive && window.layer > bestLayer)) {
                best = candidate
                bestLayer = window.layer
                bestActive = isActiveWin
            }
        }

        diag.put("windowsNull", false)
        diag.put("windowCount", currentWindows.size)
        diag.put("windows", rows)
        return if (best != null) {
            diag.put("source", "windows_scan")
            diag.put("selectedPackage", best.packageName?.toString())
            Pair(best, diag)
        } else {
            Pair(null, diag.put("reason", "target_application_window_not_found"))
        }
    }

    private fun appendWindowsDiag(diag: JSONObject) {
        val currentWindows = windows ?: return
        diag.put("windowsNull", false)
        diag.put("windowCount", currentWindows.size)
        val windowRows = JSONArray()
        var appWindows = 0; var appWindowsWithRoot = 0
        for (window in currentWindows) {
            val row = JSONObject()
            row.put("type", window.type)
            row.put("layer", window.layer)
            row.put("id", window.id)
            if (Build.VERSION.SDK_INT >= 21) {
                row.put("isActive", window.isActive)
                row.put("isFocused", window.isFocused)
            }
            val candidate = try { window.root } catch (_: Exception) { null }
            row.put("hasRoot", candidate != null)
            val pkg = candidate?.packageName?.toString()
            row.put("packageName", pkg)
            row.put("isApprovedBrowser", pkg != null && approvedBrowsers.contains(pkg))
            windowRows.put(row)
            if (window.type == AccessibilityWindowInfo.TYPE_APPLICATION) {
                appWindows += 1
                if (candidate != null) appWindowsWithRoot += 1
            }
        }
        diag.put("applicationWindowCount", appWindows)
        diag.put("applicationWindowsWithRoot", appWindowsWithRoot)
        diag.put("windows", windowRows)
    }

    private fun refreshAccessibilityRoot(root: AccessibilityNodeInfo) {
        runCatching { root.refresh() }
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
                .put("left", bounds.left).put("top", bounds.top)
                .put("right", bounds.right).put("bottom", bounds.bottom))
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

    private fun gestureSwipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Long): JSONObject {
        val values = listOf(x1, y1, x2, y2)
        if (values.any { it.isNaN() || it.isInfinite() }) return error("swipe_coordinates_required")
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) return error("swipe_coordinates_invalid")
        val duration = durationMs.coerceIn(80L, 3000L)
        if (kotlin.math.abs(x2 - x1) < 8 && kotlin.math.abs(y2 - y1) < 8) return error("swipe_distance_too_small")
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, duration))
            .build()
        val completed = CountDownLatch(1)
        val succeeded = AtomicBoolean(false)
        val accepted = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                succeeded.set(true)
                completed.countDown()
            }
            override fun onCancelled(gestureDescription: GestureDescription) {
                completed.countDown()
            }
        }, null)
        if (!accepted) return error("swipe_dispatch_rejected")
        return try {
            if (completed.await((duration + 1500L).coerceAtMost(5000L), TimeUnit.MILLISECONDS) && succeeded.get()) {
                ok(true)
                    .put("gesture", "swipe")
                    .put("x1", x1)
                    .put("y1", y1)
                    .put("x2", x2)
                    .put("y2", y2)
                    .put("durationMs", duration)
            } else {
                error("swipe_failed")
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            error("swipe_interrupted")
        }
    }

    private fun gestureClick(node: AccessibilityNodeInfo): Boolean {
        if (!node.isVisibleToUser || Build.VERSION.SDK_INT < 24) return false
        val rect = Rect().also { node.getBoundsInScreen(it) }
        if (rect.isEmpty) return false
        val path = Path().apply { moveTo(rect.exactCenterX(), rect.exactCenterY()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 80L))
            .build()
        val completed = CountDownLatch(1)
        val succeeded = AtomicBoolean(false)
        val accepted = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                succeeded.set(true)
                completed.countDown()
            }
            override fun onCancelled(gestureDescription: GestureDescription) {
                completed.countDown()
            }
        }, null)
        if (!accepted) return false
        return try {
            completed.await(1500L, TimeUnit.MILLISECONDS) && succeeded.get()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
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
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
