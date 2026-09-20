package com.robvg9.ariauiagent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import java.nio.charset.StandardCharsets

/**
 * LEGACY entrypoint kept only for forensic compatibility.
 * Official execution path is:
 *   MainActivity (visible) → owner Approve → LocalMissionRunner → AriaAccessibilityService
 *
 * This receiver no longer executes UI actions. It always returns a clear rejection
 * so Termux / am broadcast cannot drive the Accessibility service silently.
 */
class CommandReceiver : BroadcastReceiver() {
    companion object {
        private const val ACTION = "com.robvg9.ariauiagent.ACTION_EXECUTE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        finish(
            false,
            """{"ok":false,"reason":"broadcast_path_disabled","message":"Use LocalMissionRunner via ARIA UI with explicit owner approval"}"""
        )
    }

    private fun finish(ok: Boolean, json: String) {
        setResultCode(if (ok) Activity.RESULT_OK else Activity.RESULT_CANCELED)
        setResultData(encode(json))
    }

    private fun encode(value: String): String =
        Base64.encodeToString(value.toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
}
