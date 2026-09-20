package com.robvg9.ariauiagent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class CommandReceiver : BroadcastReceiver() {
    companion object {
        private const val ACTION = "com.robvg9.ariauiagent.ACTION_EXECUTE"
        private val executor = Executors.newCachedThreadPool()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return

        val sentUid = if (Build.VERSION.SDK_INT >= 34) getSentFromUid() else Binder.getCallingUid()
        val pending = goAsync()

        executor.submit {
            try {
                if (!isTrustedSender(sentUid)) {
                    finish(pending, false, """{"ok":false,"reason":"caller_not_allowed"}""")
                    return@submit
                }

                val encoded = intent.getStringExtra("payload_b64")
                if (encoded.isNullOrBlank()) {
                    finish(pending, false, """{"ok":false,"reason":"payload_missing"}""")
                    return@submit
                }

                val payload = try {
                    String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8)
                } catch (_: Exception) {
                    finish(pending, false, """{"ok":false,"reason":"payload_invalid_base64"}""")
                    return@submit
                }

                val service = AriaAccessibilityService.instance
                if (service == null) {
                    finish(pending, false, """{"ok":false,"reason":"accessibility_service_disabled"}""")
                    return@submit
                }

                val result = service.handle(payload)
                finish(pending, result.optBoolean("ok", false), result.toString())
            } catch (e: Exception) {
                val safe = e.message?.replace(Regex("[^A-Za-z0-9._:-]"), "_")?.take(120) ?: "unknown"
                finish(pending, false, """{"ok":false,"reason":"receiver_error:$safe"}""")
            }
        }

        Handler(Looper.getMainLooper()).postDelayed({
            if (!pending.isFinished) {
                pending.setResultCode(Activity.RESULT_CANCELED)
                pending.setResultData(encode("""{"ok":false,"reason":"receiver_timeout"}"""))
                pending.finish()
            }
        }, 9000L)
    }

    private fun isTrustedSender(uid: Int): Boolean =
        uid == Process.SHELL_UID

    private fun finish(pending: PendingResult, ok: Boolean, json: String) {
        if (pending.isFinished) return
        pending.setResultCode(if (ok) Activity.RESULT_OK else Activity.RESULT_CANCELED)
        pending.setResultData(encode(json))
        pending.finish()
    }

    private fun encode(value: String): String =
        Base64.encodeToString(value.toByteArray(StandardCharsets.UTF_8), Base64.NO_WRAP)
}
