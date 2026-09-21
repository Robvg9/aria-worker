package com.robvg9.ariauiagent

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * Local Mission Runner — pure device-side state machine.
 *
 * IDLE → OBSERVE → PENDING_APPROVAL → ACTION → OBSERVE → EVIDENCE → COMPLETE
 * Any point: CANCELLED / FAILED / RECOVERABLE
 *
 * Actions NEVER execute without explicit owner approval via the UI.
 * Recovery after restart never auto-runs pending actions.
 */
class LocalMissionRunner(
    private val store: LocalMissionStore,
    private val onStateChanged: (LocalMission) -> Unit = {}
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var mission: LocalMission? = null
    private val lock = Any()

    fun current(): LocalMission? = synchronized(lock) { mission }

    fun recover(): LocalMission? = synchronized(lock) {
        val loaded = store.load() ?: return null
        val safe = when (loaded.state) {
            MissionState.ACTION,
            MissionState.OBSERVE,
            MissionState.EVIDENCE -> {
                if (loaded.proposedAction != null && !loaded.proposedAction.approved) {
                    loaded.copy(
                        state = MissionState.PENDING_APPROVAL,
                        updatedAtMs = System.currentTimeMillis(),
                        lastError = "recovered_requires_reapproval"
                    )
                } else if (loaded.proposedAction != null && loaded.proposedAction.approved && loaded.proposedAction.executedAtMs == null) {
                    loaded.copy(
                        state = MissionState.PENDING_APPROVAL,
                        proposedAction = loaded.proposedAction.copy(approved = false, approvedAtMs = null),
                        updatedAtMs = System.currentTimeMillis(),
                        lastError = "recovered_requires_reapproval"
                    )
                } else {
                    loaded.copy(state = MissionState.RECOVERABLE, updatedAtMs = System.currentTimeMillis())
                }
            }
            MissionState.PENDING_APPROVAL -> loaded
            else -> loaded
        }
        mission = safe
        store.save(safe)
        notify(safe)
        safe
    }

    fun startMission(title: String = "Local ARIA mission"): LocalMission = synchronized(lock) {
        val m = LocalMission(
            title = title,
            state = MissionState.IDLE,
            updatedAtMs = System.currentTimeMillis()
        )
        mission = m
        store.save(m)
        notify(m)
        m
    }

    fun runObserve(): LocalMission = synchronized(lock) {
        val m = mission ?: return fail("no_active_mission")
        if (m.state == MissionState.CANCELLED || m.state == MissionState.COMPLETE) {
            return fail("mission_terminal")
        }
        val service = AriaAccessibilityService.instance
            ?: return fail("accessibility_service_disabled")

        val moving = m.copy(state = MissionState.OBSERVE, updatedAtMs = System.currentTimeMillis())
        mission = moving
        store.save(moving)
        notify(moving)

        val raw = try {
            service.handle("""{"operation":"observe"}""")
        } catch (e: Exception) {
            return fail("observe_exception:${e.message?.take(80)}")
        }

        val ok = raw.optBoolean("ok", false)
        val observeError = if (ok) {
            null
        } else {
            val reason = raw.optString("reason", "observe_failed")
            val diag = raw.optJSONObject("diagnostic")
            if (diag == null) {
                reason
            } else {
                val active = diag.optString("activePackage", "?")
                val wins = diag.optInt("windowCount", -1)
                val withRoot = diag.optInt("applicationWindowsWithRoot", -1)
                val hint = diag.optString("hint", "")
                val installed = diag.optJSONArray("installedApprovedBrowsers")
                val installedN = installed?.length() ?: 0
                "$reason|active=$active|wins=$wins|appRoots=$withRoot|installedBrowsers=$installedN|hint=$hint"
            }
        }
        val obs = LocalObservation(
            packageName = raw.optJSONObject("ui")?.optString("packageName")
                ?: raw.optString("packageName", null),
            uiTreeJson = raw.optJSONObject("root")?.toString()
                ?: raw.optJSONObject("ui")?.optJSONObject("root")?.toString(),
            evidenceHash = raw.optString("evidence_hash", null)
                ?: raw.optJSONObject("ui")?.optString("evidence_hash", null),
            ok = ok,
            error = observeError
        )

        val step = LocalStep(
            kind = StepKind.OBSERVE,
            index = m.steps.size,
            observation = obs,
            completedAtMs = System.currentTimeMillis(),
            error = obs.error
        )
        val next = moving.copy(
            steps = moving.steps + step,
            state = if (ok) MissionState.IDLE else MissionState.FAILED,
            lastError = obs.error,
            updatedAtMs = System.currentTimeMillis()
        )
        mission = next
        store.save(next)
        notify(next)
        next
    }

    fun proposeAction(
        actionType: String,
        targetNodeId: String? = null,
        params: Map<String, Any?> = emptyMap()
    ): LocalMission = synchronized(lock) {
        val m = mission ?: return fail("no_active_mission")
        if (m.state == MissionState.CANCELLED || m.state == MissionState.COMPLETE) {
            return fail("mission_terminal")
        }
        if (m.state == MissionState.PENDING_APPROVAL) {
            return fail("already_pending_approval")
        }

        val action = LocalAction(
            actionType = actionType,
            targetNodeId = targetNodeId,
            params = params,
            approved = false
        )
        val next = m.copy(
            proposedAction = action,
            state = MissionState.PENDING_APPROVAL,
            updatedAtMs = System.currentTimeMillis(),
            lastError = null
        )
        mission = next
        store.save(next)
        notify(next)
        next
    }

    fun approveAndExecute(): LocalMission = synchronized(lock) {
        val m = mission ?: return fail("no_active_mission")
        if (m.state != MissionState.PENDING_APPROVAL) return fail("not_pending_approval")
        val proposed = m.proposedAction ?: return fail("no_proposed_action")

        val approved = proposed.copy(
            approved = true,
            approvedAtMs = System.currentTimeMillis()
        )
        val moving = m.copy(
            proposedAction = approved,
            state = MissionState.ACTION,
            updatedAtMs = System.currentTimeMillis()
        )
        mission = moving
        store.save(moving)
        notify(moving)

        val service = AriaAccessibilityService.instance
            ?: return fail("accessibility_service_disabled")

        val actionPayload = JSONObject()
            .put("action", approved.actionType)
        if (approved.targetNodeId != null) actionPayload.put("nodeId", approved.targetNodeId)
        approved.params.forEach { (k, v) -> actionPayload.put(k, v) }

        val request = JSONObject()
            .put("operation", "action")
            .put("action", actionPayload)

        val raw = try {
            service.handle(request.toString())
        } catch (e: Exception) {
            return fail("action_exception:${e.message?.take(80)}")
        }

        val resultOk = raw.optBoolean("ok", false)
        val resultError = if (resultOk) null else raw.optString("reason", "action_failed")
        val executed = approved.copy(
            resultOk = resultOk,
            resultError = resultError,
            executedAtMs = System.currentTimeMillis()
        )

        val actionStep = LocalStep(
            kind = StepKind.ACTION,
            index = moving.steps.size,
            action = executed,
            completedAtMs = System.currentTimeMillis(),
            error = resultError
        )

        val postRaw = try {
            service.handle("""{"operation":"observe"}""")
        } catch (_: Exception) {
            JSONObject().put("ok", false).put("reason", "post_observe_failed")
        }
        val postOk = postRaw.optBoolean("ok", false)
        val postObs = LocalObservation(
            packageName = postRaw.optJSONObject("ui")?.optString("packageName")
                ?: postRaw.optString("packageName", null),
            uiTreeJson = postRaw.optJSONObject("root")?.toString()
                ?: postRaw.optJSONObject("ui")?.optJSONObject("root")?.toString(),
            evidenceHash = postRaw.optString("evidence_hash", null)
                ?: postRaw.optJSONObject("ui")?.optString("evidence_hash", null),
            ok = postOk,
            error = if (postOk) null else postRaw.optString("reason", "post_observe_failed")
        )
        val observeAfterStep = LocalStep(
            kind = StepKind.OBSERVE,
            index = moving.steps.size + 1,
            observation = postObs,
            completedAtMs = System.currentTimeMillis(),
            error = postObs.error
        )

        val observeBefore = moving.steps.asReversed().firstOrNull { it.kind == StepKind.OBSERVE }?.observation
        val chain = LocalMissionStore.chainHash(
            observeBefore = observeBefore,
            approvalTs = approved.approvedAtMs,
            action = executed,
            observeAfter = postObs
        )
        val evidence = LocalEvidence(
            chainHash = chain,
            observeBeforeId = observeBefore?.observationId,
            actionId = executed.actionId,
            observeAfterId = postObs.observationId,
            approvalTimestampMs = approved.approvedAtMs,
            notes = if (resultOk) "ok" else resultError
        )
        val evidenceStep = LocalStep(
            kind = StepKind.EVIDENCE,
            index = moving.steps.size + 2,
            evidence = evidence,
            completedAtMs = System.currentTimeMillis()
        )

        val terminalState = when {
            !resultOk -> MissionState.FAILED
            else -> MissionState.COMPLETE
        }
        val next = moving.copy(
            steps = moving.steps + actionStep + observeAfterStep + evidenceStep,
            proposedAction = null,
            state = terminalState,
            lastError = resultError,
            updatedAtMs = System.currentTimeMillis()
        )
        mission = next
        store.save(next)
        notify(next)
        next
    }

    fun reject(): LocalMission = synchronized(lock) {
        val m = mission ?: return fail("no_active_mission")
        if (m.state != MissionState.PENDING_APPROVAL) return fail("not_pending_approval")
        val next = m.copy(
            proposedAction = null,
            state = MissionState.IDLE,
            updatedAtMs = System.currentTimeMillis(),
            lastError = "rejected_by_owner"
        )
        mission = next
        store.save(next)
        notify(next)
        next
    }

    fun cancel(): LocalMission = synchronized(lock) {
        val m = mission ?: return fail("no_active_mission")
        if (m.state == MissionState.COMPLETE || m.state == MissionState.CANCELLED) {
            return m
        }
        val next = m.copy(
            state = MissionState.CANCELLED,
            cancelledByOwner = true,
            proposedAction = null,
            updatedAtMs = System.currentTimeMillis(),
            lastError = "cancelled_by_owner"
        )
        mission = next
        store.save(next)
        notify(next)
        next
    }

    fun clear(): Unit = synchronized(lock) {
        mission = null
        store.clear()
        notify(LocalMission(state = MissionState.IDLE, title = "(cleared)"))
    }

    private fun fail(reason: String): LocalMission {
        val m = mission
        val next = (m ?: LocalMission()).copy(
            state = MissionState.FAILED,
            lastError = reason,
            updatedAtMs = System.currentTimeMillis()
        )
        mission = next
        store.save(next)
        notify(next)
        return next
    }

    private fun notify(m: LocalMission) {
        mainHandler.post { onStateChanged(m) }
    }
}
