package com.robvg9.ariauiagent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import java.nio.charset.StandardCharsets

class CommandReceiver : BroadcastReceiver() {
    companion object {
        private const val ACTION = "com.robvg9.ariauiagent.ACTION_EXECUTE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return

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
