package com.robvg9.ariauiagent

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Local durable store for a single active mission.
 * Recovery rule: never auto-execute a pending action after process death.
 * PENDING_APPROVAL stays PENDING_APPROVAL until the owner acts.
 */
class LocalMissionStore(context: Context) {
    private val file = File(context.filesDir, "local_mission.json")
    private val lock = Any()

    fun load(): LocalMission? = synchronized(lock) {
        if (!file.exists()) return null
        return try {
            val text = file.readText(StandardCharsets.UTF_8)
            if (text.isBlank()) return null
            LocalMission.fromJson(JSONObject(text))
        } catch (_: Exception) {
            null
        }
    }

    fun save(mission: LocalMission) = synchronized(lock) {
        file.writeText(mission.toJson().toString(), StandardCharsets.UTF_8)
    }

    fun clear() = synchronized(lock) {
        if (file.exists()) file.delete()
    }

    companion object {
        fun sha256(value: String): String {
            val bytes = MessageDigest.getInstance("SHA-256")
                .digest(value.toByteArray(StandardCharsets.UTF_8))
            return bytes.joinToString("") { "%02x".format(it) }
        }

        /**
         * Build chain hash: observeBefore + approvalTs + action payload + observeAfter.
         */
        fun chainHash(
            observeBefore: LocalObservation?,
            approvalTs: Long?,
            action: LocalAction?,
            observeAfter: LocalObservation?
        ): String {
            val payload = buildString {
                append(observeBefore?.evidenceHash ?: "null")
                append("|")
                append(approvalTs?.toString() ?: "null")
                append("|")
                append(action?.actionId ?: "null")
                append("|")
                append(action?.actionType ?: "null")
                append("|")
                append(action?.targetNodeId ?: "null")
                append("|")
                append(observeAfter?.evidenceHash ?: "null")
            }
            return sha256(payload)
        }
    }
}
