package com.robvg9.ariauiagent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.util.Base64
import java.nio.charset.StandardCharsets

/**
 * Governed Termux IPC entrypoint.
 * The sender UID must match the installed Termux app UID before any
 * AccessibilityService action is executed. The interactive Local Mission
 * flow remains available separately for explicit Human Gate testing.
 */
class CommandReceiver : BroadcastReceiver() {
    companion object {
        private const val ACTION = "com.robvg9.ariauiagent.ACTION_EXECUTE"
        private const val TERMUX_PACKAGE = "com.termux"
        // Fallback authentication for Android 14+ shell broadcasts where
        // getSentFromUid() is INVALID_UID because the sender identity is not shared.
        // This is IPC authentication only; it is not a user credential or API secret.
        private const val IPC_TOKEN = "4fa3c34b8093d0ac3633fd58ade90bc224827f2a7b21cf29f26931c637e34d76"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return

        val senderUid = if (Build.VERSION.SDK_INT >= 34) getSentFromUid() else Binder.getCallingUid()
        val termuxUid = try {
            context.packageManager.getApplicationInfo(TERMUX_PACKAGE, 0).uid
        } catch (_: Exception) {
            -1
        }
        val tokenValid = intent.getStringExtra("ipc_token") == IPC_TOKEN
        val senderAuthorized = senderUid == termuxUid && senderUid >= 0
        if (!senderAuthorized && !tokenValid) {
            finish(false, """{"ok":false,"reason":"caller_not_allowed"}""")
            return
        }

        val encoded = intent.getStringExtra("payload_b64")
        if (encoded.isNullOrBlank()) {
            finish(false, """{"ok":false,"reason":"payload_missing"}""")
            return
        }

        val payload = try {
            String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8)
        } catch (_: Exception) {
            finish(false, """{"ok":false,"reason":"payload_invalid_base64"}""")
            return
        }

        val service = AriaAccessibilityService.instance
        if (service == null) {
            finish(false, """{"ok":false,"reason":"accessibility_service_disabled"}""")
            return
        }

        try {
            val result = service.handle(payload)
            finish(result.optBoolean("ok", false), result.toString())
        } catch (e: Exception) {
            val safe = e.message?.replace(Regex("[^A-Za-z0-9._:-]"), "_")?.take(120) ?: "unknown"
            finish(false, """{"ok":false,"reason":"receiver_error:$safe"}""")
        }
    }

    private fun finish(ok: Boolean, json: String) {
        setResultCode(if (ok) Activity.RESULT_OK else Activity.RESULT_CANCELED)
        setResultData(encode(json))
    }

    private fun encode(value: String): String =
        Base64.encodeToString(value.toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
}
