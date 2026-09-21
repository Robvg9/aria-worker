package com.robvg9.ariauiagent

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PostActionResponseTest {

    @Test
    fun success_with_embedded_ui() {
        val raw = JSONObject()
            .put("ok", true)
            .put("ui", JSONObject()
                .put("ok", true)
                .put("packageName", "com.android.chrome")
                .put("root", JSONObject().put("id", "0"))
                .put("evidence_hash", "abc123"))
            .put("diagnostic", JSONObject().put("resolvePhase", "post_action"))

        val obs = PostActionResponse.parse(raw)
        assertTrue(obs.ok)
        assertEquals("com.android.chrome", obs.packageName)
        assertNotNull(obs.uiTreeJson)
        assertEquals("abc123", obs.evidenceHash)
        assertNull(obs.error)
        assertNotNull(obs.diagnosticJson)
    }

    @Test
    fun failure_post_action_window_missing() {
        val raw = JSONObject()
            .put("ok", false)
            .put("reason", "post_action_window_missing")
            .put("diagnostic", JSONObject()
                .put("activePackage", "com.robvg9.ariauiagent.debug")
                .put("resolvePhase", "post_action"))

        val obs = PostActionResponse.parse(raw)
        assertFalse(obs.ok)
        assertEquals("post_action_window_missing", obs.error)
        assertNull(obs.packageName)
        assertNotNull(obs.diagnosticJson)
    }

    @Test
    fun action_failed_without_ui() {
        val raw = JSONObject()
            .put("ok", false)
            .put("reason", "click_failed")

        val obs = PostActionResponse.parse(raw)
        assertFalse(obs.ok)
        assertEquals("click_failed", obs.error)
    }
}
