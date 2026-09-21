package com.robvg9.ariauiagent

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.UUID

class AndroidAgentClient(context: Context) {
    companion object {
        private const val GATEWAY = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway"
        private const val PWA = "https://aria.robvg9.workers.dev/pwa/"
        private const val PREFS = "aria_android_agent"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val random = SecureRandom()

    @Synchronized
    fun ensureIdentity() {
        if (prefs.getString("device_id", null).isNullOrBlank()) {
            prefs.edit().putString("device_id", "android-ui-" + UUID.randomUUID()).apply()
        }
        if (prefs.getString("pair_code", null).isNullOrBlank() && !hasToken()) {
            val code = random.nextInt(1_000_000).toString().padStart(6, '0')
            prefs.edit().putString("pair_code", code).apply()
        }
    }

    fun deviceId(): String = prefs.getString("device_id", "") ?: ""
    fun pairingCode(): String = prefs.getString("pair_code", "") ?: ""
    fun hasToken(): Boolean = prefs.getString("device_token", "").orEmpty().isNotBlank()

    fun pairingUrl(): String =
        PWA + "?pair_device=" + deviceId() + "&pair_code=" + pairingCode()

    @Synchronized
    fun startPairingIfNeeded(): JSONObject {
        ensureIdentity()
        val started = prefs.getLong("pair_started_at", 0L)
        if (started > 0L && System.currentTimeMillis() - started < 10 * 60_000L) {
            return JSONObject().put("ok", true).put("status", "pending")
        }
        val response = request(
            "/v1/android/pair/start",
            JSONObject().put("device_id", deviceId()).put("pair_code", pairingCode()),
            false
        )
        if (response.optBoolean("ok", false)) {
            prefs.edit().putLong("pair_started_at", System.currentTimeMillis()).apply()
        }
        return response
    }

    @Synchronized
    fun pollPairing(): JSONObject {
        if (hasToken()) return JSONObject().put("ok", true).put("status", "paired")
        val response = request(
            "/v1/android/pair/poll",
            JSONObject().put("device_id", deviceId()).put("pair_code", pairingCode()),
            false
        )
        val token = response.optString("device_token", "")
        if (response.optBoolean("paired", false) && token.isNotBlank()) {
            prefs.edit()
                .putString("device_token", token)
                .remove("pair_code")
                .remove("pair_started_at")
                .apply()
        }
        return response
    }

    private var lastHeartbeatAt = 0L

    fun heartbeatIfDue(): JSONObject? {
        val now = System.currentTimeMillis()
        if (now - lastHeartbeatAt < 15_000L) return null
        lastHeartbeatAt = now
        return request(
            "/v1/devices/heartbeat",
            JSONObject()
                .put("device_id", deviceId())
                .put("agent_type", "android-ui")
                .put(
                    "capabilities",
                    JSONArray()
                        .put("computer.use.android")
                        .put("android.ui.mission")
                ),
            true
        )
    }

    fun claimJob(): JSONObject =
        request("/v1/jobs/claim", JSONObject().put("device_id", deviceId()), true)

    fun startJob(jobId: String): JSONObject =
        request(
            "/v1/jobs/" + jobId + "/start",
            JSONObject().put("device_id", deviceId()),
            true
        )

    fun completeJob(
        jobId: String,
        status: String,
        exitCode: Int,
        stdout: String,
        stderr: String,
        metadata: JSONObject,
        durationMs: Long
    ): JSONObject {
        val result = JSONObject()
            .put("status", status)
            .put("exit_code", exitCode)
            .put("stdout", stdout.take(100_000))
            .put("stderr", stderr.take(8_000))
            .put("duration_ms", durationMs)
            .put("metadata", metadata)
        return request(
            "/v1/jobs/" + jobId + "/result",
            JSONObject().put("device_id", deviceId()).put("result", result),
            true
        )
    }

    fun decideUi(
        goal: String,
        ui: JSONObject,
        history: JSONArray,
        step: Int,
        maxSteps: Int
    ): JSONObject {
        val response = request(
            "/v1/android/ui/decide",
            JSONObject()
                .put("device_id", deviceId())
                .put("goal", goal)
                .put("ui", ui)
                .put("history", history)
                .put("step", step)
                .put("max_steps", maxSteps)
                .put("risk", "LOW_RISK_WRITE"),
            true
        )
        return response.optJSONObject("decision")
            ?: JSONObject().put("content", response.optString("content", ""))
    }

    private fun request(path: String, payload: JSONObject, authenticated: Boolean): JSONObject {
        val connection = (URL(GATEWAY + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12_000
            readTimeout = 25_000
            doInput = true
            doOutput = true
            setRequestProperty("content-type", "application/json")
            setRequestProperty("cache-control", "no-store")
            if (authenticated && hasToken()) {
                setRequestProperty(
                    "authorization",
                    "Bearer " + (prefs.getString("device_token", "") ?: "")
                )
            }
        }
        return try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload.toString()) }
            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }
            val responseText =
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            runCatching { JSONObject(responseText) }
                .getOrElse {
                    JSONObject()
                        .put("ok", false)
                        .put("error", "invalid_gateway_json")
                        .put("http_status", connection.responseCode)
                }
        } finally {
            connection.disconnect()
        }
    }
}
