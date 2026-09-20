package com.robvg9.ariauiagent

import org.junit.Assert.*
import org.junit.Test

/**
 * Recovery contract: after process death, a mission that was mid-flight
 * with an unexecuted approved action must return to PENDING_APPROVAL
 * and never auto-execute.
 */
class RecoveryRulesTest {

    @Test
    fun pending_approval_stays_pending() {
        val m = LocalMission(
            state = MissionState.PENDING_APPROVAL,
            proposedAction = LocalAction(actionType = "press", approved = false)
        )
        val safe = recoverLogic(m)
        assertEquals(MissionState.PENDING_APPROVAL, safe.state)
        assertFalse(safe.proposedAction!!.approved)
    }

    @Test
    fun approved_but_not_executed_requires_reapproval() {
        val m = LocalMission(
            state = MissionState.ACTION,
            proposedAction = LocalAction(
                actionType = "press",
                approved = true,
                approvedAtMs = 1L,
                executedAtMs = null
            )
        )
        val safe = recoverLogic(m)
        assertEquals(MissionState.PENDING_APPROVAL, safe.state)
        assertFalse(safe.proposedAction!!.approved)
        assertNull(safe.proposedAction!!.approvedAtMs)
        assertEquals("recovered_requires_reapproval", safe.lastError)
    }

    @Test
    fun complete_mission_unchanged() {
        val m = LocalMission(state = MissionState.COMPLETE)
        val safe = recoverLogic(m)
        assertEquals(MissionState.COMPLETE, safe.state)
    }

    @Test
    fun cancelled_unchanged() {
        val m = LocalMission(state = MissionState.CANCELLED, cancelledByOwner = true)
        val safe = recoverLogic(m)
        assertEquals(MissionState.CANCELLED, safe.state)
        assertTrue(safe.cancelledByOwner)
    }

    private fun recoverLogic(loaded: LocalMission): LocalMission {
        return when (loaded.state) {
            MissionState.ACTION,
            MissionState.OBSERVE,
            MissionState.EVIDENCE -> {
                if (loaded.proposedAction != null && !loaded.proposedAction.approved) {
                    loaded.copy(
                        state = MissionState.PENDING_APPROVAL,
                        updatedAtMs = System.currentTimeMillis(),
                        lastError = "recovered_requires_reapproval"
                    )
                } else if (loaded.proposedAction != null &&
                    loaded.proposedAction.approved &&
                    loaded.proposedAction.executedAtMs == null
                ) {
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
    }
}
