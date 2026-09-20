package com.robvg9.ariauiagent

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Pure JVM tests for models, serialization, chain hash and recovery rules.
 * Does not require a device or AccessibilityService.
 */
class LocalMissionModelsTest {

    @Test
    fun mission_roundtrip_json() {
        val action = LocalAction(
            actionType = "click",
            targetNodeId = "0.1.2",
            params = mapOf("x" to 10),
            approved = false
        )
        val obs = LocalObservation(
            packageName = "com.android.chrome",
            evidenceHash = "abc123",
            ok = true
        )
        val step = LocalStep(kind = StepKind.OBSERVE, index = 0, observation = obs)
        val mission = LocalMission(
            title = "test",
            state = MissionState.PENDING_APPROVAL,
            steps = listOf(step),
            proposedAction = action
        )
        val json = mission.toJson().toString()
        val restored = LocalMission.fromJson(JSONObject(json))
        assertEquals(mission.missionId, restored.missionId)
        assertEquals(MissionState.PENDING_APPROVAL, restored.state)
        assertEquals("click", restored.proposedAction?.actionType)
        assertEquals("0.1.2", restored.proposedAction?.targetNodeId)
        assertEquals("com.android.chrome", restored.steps[0].observation?.packageName)
        assertEquals("abc123", restored.steps[0].observation?.evidenceHash)
    }

    @Test
    fun chain_hash_is_deterministic() {
        val before = LocalObservation(evidenceHash = "hashA")
        val after = LocalObservation(evidenceHash = "hashB")
        val action = LocalAction(actionType = "press", targetNodeId = null, params = mapOf("keyCode" to 4))
        val h1 = LocalMissionStore.chainHash(before, 1000L, action, after)
        val h2 = LocalMissionStore.chainHash(before, 1000L, action, after)
        assertEquals(h1, h2)
        assertEquals(64, h1.length)
        val h3 = LocalMissionStore.chainHash(before, 1001L, action, after)
        assertNotEquals(h1, h3)
    }

    @Test
    fun state_enum_covers_required() {
        val required = listOf(
            "IDLE", "OBSERVE", "PENDING_APPROVAL", "ACTION",
            "EVIDENCE", "COMPLETE", "CANCELLED", "FAILED", "RECOVERABLE"
        )
        required.forEach { name ->
            assertNotNull(MissionState.valueOf(name))
        }
    }

    @Test
    fun local_action_defaults_not_approved() {
        val a = LocalAction(actionType = "scroll")
        assertFalse(a.approved)
        assertNull(a.executedAtMs)
        assertNull(a.resultOk)
    }

    @Test
    fun evidence_roundtrip() {
        val e = LocalEvidence(
            chainHash = "deadbeef",
            observeBeforeId = "o1",
            actionId = "a1",
            observeAfterId = "o2",
            approvalTimestampMs = 42L
        )
        val restored = LocalEvidence.fromJson(e.toJson())
        assertEquals("deadbeef", restored.chainHash)
        assertEquals("o1", restored.observeBeforeId)
        assertEquals(42L, restored.approvalTimestampMs)
    }
}
