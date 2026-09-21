package com.robvg9.ariauiagent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProposeGateTest {

    @Test
    fun idle_zero_steps_cannot_propose() {
        val m = LocalMission(state = MissionState.IDLE, title = "fresh")
        assertFalse(ProposeGate.canPropose(m))
    }

    @Test
    fun idle_last_observe_ok_can_propose() {
        val obs = LocalObservation(packageName = "com.android.chrome", ok = true)
        val step = LocalStep(kind = StepKind.OBSERVE, index = 0, observation = obs)
        val m = LocalMission(
            state = MissionState.IDLE,
            title = "after observe",
            steps = listOf(step)
        )
        assertTrue(ProposeGate.canPropose(m))
    }

    @Test
    fun idle_last_observe_failed_cannot_propose() {
        val obs = LocalObservation(ok = false, error = "no_active_browser_window")
        val step = LocalStep(kind = StepKind.OBSERVE, index = 0, observation = obs)
        val m = LocalMission(state = MissionState.IDLE, steps = listOf(step))
        assertFalse(ProposeGate.canPropose(m))
    }

    @Test
    fun waiting_observe_cannot_propose() {
        val obs = LocalObservation(ok = true)
        val step = LocalStep(kind = StepKind.OBSERVE, index = 0, observation = obs)
        val m = LocalMission(state = MissionState.WAITING_OBSERVE, steps = listOf(step))
        assertFalse(ProposeGate.canPropose(m))
    }
}
