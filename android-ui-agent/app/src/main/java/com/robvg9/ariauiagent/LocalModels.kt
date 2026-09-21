package com.robvg9.ariauiagent

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Local-first mission models for ARIA Android.
 * Deterministic IDs, timestamps, and explicit state machine.
 * No remote queue; no invisible execution.
 */

enum class MissionState {
    IDLE,
    OBSERVE,
    PENDING_APPROVAL,
    ACTION,
    EVIDENCE,
    COMPLETE,
    CANCELLED,
    FAILED,
    RECOVERABLE
}

enum class StepKind {
    OBSERVE,
    ACTION,
    EVIDENCE,
    APPROVAL
}

data class LocalObservation(
    val observationId: String = UUID.randomUUID().toString(),
    val timestampMs: Long = System.currentTimeMillis(),
    val packageName: String? = null,
    val activityHint: String? = null,
    val uiTreeJson: String? = null,
    val evidenceHash: String? = null,
    val ok: Boolean = true,
    val error: String? = null,
    /** Full JSON from resolveApprovedBrowserRootWithDiag() when observe fails. */
    val diagnosticJson: String? = null
) {
    fun toJson(): JSONObject = JSONObject()
        .put("observationId", observationId)
        .put("timestampMs", timestampMs)
        .put("packageName", packageName)
        .put("activityHint", activityHint)
        .put("uiTreeJson", uiTreeJson)
        .put("evidenceHash", evidenceHash)
        .put("ok", ok)
        .put("error", error)
        .put("diagnosticJson", diagnosticJson)

    companion object {
        fun fromJson(o: JSONObject): LocalObservation = LocalObservation(
            observationId = o.optString("observationId", UUID.randomUUID().toString()),
            timestampMs = o.optLong("timestampMs", System.currentTimeMillis()),
            packageName = o.optString("packageName", null),
            activityHint = o.optString("activityHint", null),
            uiTreeJson = o.optString("uiTreeJson", null),
            evidenceHash = o.optString("evidenceHash", null),
            ok = o.optBoolean("ok", true),
            error = o.optString("error", null),
            diagnosticJson = o.optString("diagnosticJson", null)
        )
    }
}

data class LocalAction(
    val actionId: String = UUID.randomUUID().toString(),
    val timestampMs: Long = System.currentTimeMillis(),
    val actionType: String,
    val targetNodeId: String? = null,
    val params: Map<String, Any?> = emptyMap(),
    val approved: Boolean = false,
    val approvedAtMs: Long? = null,
    val resultOk: Boolean? = null,
    val resultError: String? = null,
    val executedAtMs: Long? = null
) {
    fun toJson(): JSONObject {
        val p = JSONObject()
        params.forEach { (k, v) -> p.put(k, v) }
        return JSONObject()
            .put("actionId", actionId)
            .put("timestampMs", timestampMs)
            .put("actionType", actionType)
            .put("targetNodeId", targetNodeId)
            .put("params", p)
            .put("approved", approved)
            .put("approvedAtMs", approvedAtMs)
            .put("resultOk", resultOk)
            .put("resultError", resultError)
            .put("executedAtMs", executedAtMs)
    }

    companion object {
        fun fromJson(o: JSONObject): LocalAction {
            val pObj = o.optJSONObject("params") ?: JSONObject()
            val params = mutableMapOf<String, Any?>()
            pObj.keys().forEach { key -> params[key] = pObj.opt(key) }
            return LocalAction(
                actionId = o.optString("actionId", UUID.randomUUID().toString()),
                timestampMs = o.optLong("timestampMs", System.currentTimeMillis()),
                actionType = o.optString("actionType", "unsupported"),
                targetNodeId = o.optString("targetNodeId", null),
                params = params,
                approved = o.optBoolean("approved", false),
                approvedAtMs = if (o.has("approvedAtMs") && !o.isNull("approvedAtMs")) o.optLong("approvedAtMs") else null,
                resultOk = if (o.has("resultOk") && !o.isNull("resultOk")) o.optBoolean("resultOk") else null,
                resultError = o.optString("resultError", null),
                executedAtMs = if (o.has("executedAtMs") && !o.isNull("executedAtMs")) o.optLong("executedAtMs") else null
            )
        }
    }
}

data class LocalEvidence(
    val evidenceId: String = UUID.randomUUID().toString(),
    val timestampMs: Long = System.currentTimeMillis(),
    val chainHash: String,
    val observeBeforeId: String? = null,
    val actionId: String? = null,
    val observeAfterId: String? = null,
    val approvalTimestampMs: Long? = null,
    val notes: String? = null
) {
    fun toJson(): JSONObject = JSONObject()
        .put("evidenceId", evidenceId)
        .put("timestampMs", timestampMs)
        .put("chainHash", chainHash)
        .put("observeBeforeId", observeBeforeId)
        .put("actionId", actionId)
        .put("observeAfterId", observeAfterId)
        .put("approvalTimestampMs", approvalTimestampMs)
        .put("notes", notes)

    companion object {
        fun fromJson(o: JSONObject): LocalEvidence = LocalEvidence(
            evidenceId = o.optString("evidenceId", UUID.randomUUID().toString()),
            timestampMs = o.optLong("timestampMs", System.currentTimeMillis()),
            chainHash = o.optString("chainHash", ""),
            observeBeforeId = o.optString("observeBeforeId", null),
            actionId = o.optString("actionId", null),
            observeAfterId = o.optString("observeAfterId", null),
            approvalTimestampMs = if (o.has("approvalTimestampMs") && !o.isNull("approvalTimestampMs")) o.optLong("approvalTimestampMs") else null,
            notes = o.optString("notes", null)
        )
    }
}

data class LocalStep(
    val stepId: String = UUID.randomUUID().toString(),
    val kind: StepKind,
    val index: Int,
    val createdAtMs: Long = System.currentTimeMillis(),
    val completedAtMs: Long? = null,
    val observation: LocalObservation? = null,
    val action: LocalAction? = null,
    val evidence: LocalEvidence? = null,
    val error: String? = null
) {
    fun toJson(): JSONObject = JSONObject()
        .put("stepId", stepId)
        .put("kind", kind.name)
        .put("index", index)
        .put("createdAtMs", createdAtMs)
        .put("completedAtMs", completedAtMs)
        .put("observation", observation?.toJson())
        .put("action", action?.toJson())
        .put("evidence", evidence?.toJson())
        .put("error", error)

    companion object {
        fun fromJson(o: JSONObject): LocalStep = LocalStep(
            stepId = o.optString("stepId", UUID.randomUUID().toString()),
            kind = runCatching { StepKind.valueOf(o.optString("kind", "OBSERVE")) }.getOrDefault(StepKind.OBSERVE),
            index = o.optInt("index", 0),
            createdAtMs = o.optLong("createdAtMs", System.currentTimeMillis()),
            completedAtMs = if (o.has("completedAtMs") && !o.isNull("completedAtMs")) o.optLong("completedAtMs") else null,
            observation = o.optJSONObject("observation")?.let { LocalObservation.fromJson(it) },
            action = o.optJSONObject("action")?.let { LocalAction.fromJson(it) },
            evidence = o.optJSONObject("evidence")?.let { LocalEvidence.fromJson(it) },
            error = o.optString("error", null)
        )
    }
}

data class LocalMission(
    val missionId: String = UUID.randomUUID().toString(),
    val createdAtMs: Long = System.currentTimeMillis(),
    val updatedAtMs: Long = System.currentTimeMillis(),
    val title: String = "Local mission",
    val state: MissionState = MissionState.IDLE,
    val steps: List<LocalStep> = emptyList(),
    val proposedAction: LocalAction? = null,
    val lastError: String? = null,
    val cancelledByOwner: Boolean = false
) {
    fun currentStep(): LocalStep? = steps.lastOrNull()

    fun toJson(): JSONObject {
        val arr = JSONArray()
        steps.forEach { arr.put(it.toJson()) }
        return JSONObject()
            .put("missionId", missionId)
            .put("createdAtMs", createdAtMs)
            .put("updatedAtMs", updatedAtMs)
            .put("title", title)
            .put("state", state.name)
            .put("steps", arr)
            .put("proposedAction", proposedAction?.toJson())
            .put("lastError", lastError)
            .put("cancelledByOwner", cancelledByOwner)
    }

    companion object {
        fun fromJson(o: JSONObject): LocalMission {
            val stepsArr = o.optJSONArray("steps") ?: JSONArray()
            val steps = mutableListOf<LocalStep>()
            for (i in 0 until stepsArr.length()) {
                stepsArr.optJSONObject(i)?.let { steps.add(LocalStep.fromJson(it)) }
            }
            return LocalMission(
                missionId = o.optString("missionId", UUID.randomUUID().toString()),
                createdAtMs = o.optLong("createdAtMs", System.currentTimeMillis()),
                updatedAtMs = o.optLong("updatedAtMs", System.currentTimeMillis()),
                title = o.optString("title", "Local mission"),
                state = runCatching { MissionState.valueOf(o.optString("state", "IDLE")) }.getOrDefault(MissionState.IDLE),
                steps = steps,
                proposedAction = o.optJSONObject("proposedAction")?.let { LocalAction.fromJson(it) },
                lastError = o.optString("lastError", null),
                cancelledByOwner = o.optBoolean("cancelledByOwner", false)
            )
        }
    }
}
