package com.robvg9.ariauiagent

import org.json.JSONObject

/**
 * Brings the observed approved browser to the foreground using a legitimate
 * launch Intent from the AccessibilityService Context, then polls until
 * observe reports that package (or fails with browser_handoff_failed).
 */
object BrowserHandoffExecutor {

    fun execute(service: AriaAccessibilityService, targetPackage: String): JSONObject {
        val diag = JSONObject()
        diag.put("observedBrowserPackage", targetPackage)
        diag.put("handoffMethod", BrowserHandoff.HANDOFF_METHOD)
        diag.put("resolvePhase", "browser_handoff")

        val launch = try {
            service.packageManager.getLaunchIntentForPackage(targetPackage)
        } catch (_: Exception) {
            null
        }
        if (launch == null) {
            diag.put("hint", "launch_intent_null_package_not_launchable")
            diag.put("startActivity", "skipped")
            return JSONObject()
                .put("ok", false)
                .put("reason", "browser_handoff_failed")
                .put("diagnostic", diag)
        }

        launch.addFlags(BrowserHandoff.HANDOFF_INTENT_FLAGS)
        try {
            service.startActivity(launch)
            diag.put("startActivity", "ok")
        } catch (e: Exception) {
            diag.put("startActivity", "failed")
            diag.put("startActivityError", e.message?.take(80))
            return JSONObject()
                .put("ok", false)
                .put("reason", "browser_handoff_failed")
                .put("diagnostic", diag)
        }

        var lastDiag: JSONObject? = null
        for (attempt in 0 until BrowserHandoff.HANDOFF_POLL_ATTEMPTS) {
            if (attempt > 0) Thread.sleep(BrowserHandoff.HANDOFF_POLL_DELAY_MS)
            val obs = try {
                service.handle("{\"operation\":\"observe\"}")
            } catch (e: Exception) {
                diag.put("observeException", e.message?.take(80))
                continue
            }
            val oDiag = obs.optJSONObject("diagnostic")
            if (oDiag != null) lastDiag = oDiag
            val pkg = obs.optString("packageName", null)
                ?: obs.optJSONObject("ui")?.optString("packageName", null)
            if (obs.optBoolean("ok", false) && pkg == targetPackage) {
                diag.put("handoffConfirmedAttempt", attempt + 1)
                diag.put("handoffPollAttemptsMax", BrowserHandoff.HANDOFF_POLL_ATTEMPTS)
                diag.put("foregroundAfterHandoff", pkg)
                diag.put("selectedPackage", pkg)
                if (oDiag != null) {
                    val keys = oDiag.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        if (!diag.has(k)) diag.put(k, oDiag.get(k))
                    }
                }
                return JSONObject().put("ok", true).put("diagnostic", diag)
            }
        }

        diag.put("handoffConfirmedAttempt", 0)
        diag.put("handoffPollAttemptsMax", BrowserHandoff.HANDOFF_POLL_ATTEMPTS)
        diag.put("hint", "browser_window_not_published_after_launch_intent")
        if (lastDiag != null) {
            val keys = lastDiag.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (!diag.has(k)) diag.put(k, lastDiag.get(k))
            }
        }
        return JSONObject()
            .put("ok", false)
            .put("reason", "browser_handoff_failed")
            .put("diagnostic", diag)
    }
}
