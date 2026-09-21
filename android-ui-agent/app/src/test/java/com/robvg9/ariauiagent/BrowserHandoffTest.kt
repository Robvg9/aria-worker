package com.robvg9.ariauiagent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserHandoffTest {

    private val approved = setOf("com.android.chrome", "org.mozilla.firefox")

    @Test
    fun selectObservedBrowser_fromLastSuccessfulObserve() {
        val steps = listOf(
            LocalStep(
                kind = StepKind.OBSERVE,
                index = 0,
                observation = LocalObservation(
                    packageName = "com.android.chrome",
                    ok = true
                )
            )
        )
        assertEquals("com.android.chrome", BrowserHandoff.selectObservedBrowserPackage(steps))
    }

    @Test
    fun selectObservedBrowser_ignoresFailedObserve() {
        val steps = listOf(
            LocalStep(
                kind = StepKind.OBSERVE,
                index = 0,
                observation = LocalObservation(packageName = "com.android.chrome", ok = false)
            )
        )
        assertNull(BrowserHandoff.selectObservedBrowserPackage(steps))
    }

    @Test
    fun selectObservedBrowser_emptySteps() {
        assertNull(BrowserHandoff.selectObservedBrowserPackage(emptyList()))
    }

    @Test
    fun selectObservedBrowser_prefersLatestSuccessful() {
        val steps = listOf(
            LocalStep(
                kind = StepKind.OBSERVE,
                index = 0,
                observation = LocalObservation(packageName = "org.mozilla.firefox", ok = true)
            ),
            LocalStep(kind = StepKind.ACTION, index = 1),
            LocalStep(
                kind = StepKind.OBSERVE,
                index = 2,
                observation = LocalObservation(packageName = "com.android.chrome", ok = true)
            )
        )
        assertEquals("com.android.chrome", BrowserHandoff.selectObservedBrowserPackage(steps))
    }

    @Test
    fun isApprovedBrowser() {
        assertTrue(BrowserHandoff.isApprovedBrowser("com.android.chrome", approved))
        assertFalse(BrowserHandoff.isApprovedBrowser("com.sec.android.app.launcher", approved))
        assertFalse(BrowserHandoff.isApprovedBrowser(null, approved))
        assertFalse(BrowserHandoff.isApprovedBrowser("", approved))
    }

    @Test
    fun handoffFlags_includeReorderAndNewTask() {
        val f = BrowserHandoff.HANDOFF_INTENT_FLAGS
        assertTrue(f and android.content.Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(f and android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT != 0)
        assertTrue(f and android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
        assertTrue(f and android.content.Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED != 0)
    }
}
