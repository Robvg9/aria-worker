package com.robvg9.ariauiagent

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Pure JVM tests for browser-window diagnostic payload shape used when
 * observe fails with no_active_browser_window.
 */
class BrowserWindowDiagTest {

    @Test
    fun diagnostic_includes_active_and_hint() {
        val diag = JSONObject()
            .put("activePackage", "com.robvg9.ariauiagent.debug")
            .put("activeIsBrowser", false)
            .put("windowCount", 2)
            .put("applicationWindowsWithRoot", 1)
            .put("installedApprovedBrowsers", JSONArray().put("com.android.chrome"))
            .put("hint", "foreground_is_not_browser_open_chrome_then_keep_it_in_recents_before_observe")

        val reason = "no_active_browser_window"
        val active = diag.optString("activePackage", "?")
        val wins = diag.optInt("windowCount", -1)
        val withRoot = diag.optInt("applicationWindowsWithRoot", -1)
        val hint = diag.optString("hint", "")
        val installedN = diag.optJSONArray("installedApprovedBrowsers")?.length() ?: 0
        val formatted =
            "$reason|active=$active|wins=$wins|appRoots=$withRoot|installedBrowsers=$installedN|hint=$hint"

        assertTrue(formatted.contains("com.robvg9.ariauiagent.debug"))
        assertTrue(formatted.contains("wins=2"))
        assertTrue(formatted.contains("installedBrowsers=1"))
        assertTrue(formatted.contains("foreground_is_not_browser"))
    }

    @Test
    fun chrome_variants_are_recognized_as_allowlist_members() {
        val approved = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.google.android.apps.chrome",
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "org.mozilla.focus",
            "com.brave.browser",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.microsoft.emmx",
            "com.sec.android.app.sbrowser",
            "com.android.browser"
        )
        assertTrue(approved.contains("com.android.chrome"))
        assertTrue(approved.contains("com.chrome.beta"))
        assertTrue(approved.contains("com.sec.android.app.sbrowser"))
        assertFalse(approved.contains("com.robvg9.ariauiagent"))
        assertFalse(approved.contains("com.robvg9.ariauiagent.debug"))
    }

    @Test
    fun diagnostic_full_shape_for_ui() {
        val windows = JSONArray()
            .put(JSONObject()
                .put("type", 1)
                .put("layer", 0)
                .put("id", 42)
                .put("isActive", true)
                .put("isFocused", true)
                .put("hasRoot", true)
                .put("packageName", "com.android.chrome")
                .put("isApprovedBrowser", true))
            .put(JSONObject()
                .put("type", 1)
                .put("layer", 1)
                .put("id", 7)
                .put("isActive", false)
                .put("isFocused", false)
                .put("hasRoot", false)
                .put("packageName", JSONObject.NULL)
                .put("isApprovedBrowser", false))
        val diag = JSONObject()
            .put("activePackage", "com.robvg9.ariauiagent.debug")
            .put("activeIsBrowser", false)
            .put("installedApprovedBrowsers", JSONArray().put("com.android.chrome"))
            .put("windowsNull", false)
            .put("windowCount", 2)
            .put("applicationWindowCount", 2)
            .put("applicationWindowsWithRoot", 1)
            .put("hint", "foreground_is_not_browser_open_chrome_then_keep_it_in_recents_before_observe")
            .put("windows", windows)

        assertEquals("com.robvg9.ariauiagent.debug", diag.getString("activePackage"))
        assertFalse(diag.getBoolean("activeIsBrowser"))
        assertEquals(1, diag.getJSONArray("installedApprovedBrowsers").length())
        assertFalse(diag.getBoolean("windowsNull"))
        assertEquals(2, diag.getInt("windowCount"))
        assertEquals(2, diag.getInt("applicationWindowCount"))
        assertEquals(1, diag.getInt("applicationWindowsWithRoot"))
        assertTrue(diag.getString("hint").contains("foreground_is_not_browser"))
        assertEquals(2, diag.getJSONArray("windows").length())
        val w0 = diag.getJSONArray("windows").getJSONObject(0)
        assertEquals(1, w0.getInt("type"))
        assertTrue(w0.getBoolean("isActive"))
        assertTrue(w0.getBoolean("hasRoot"))
        assertTrue(w0.getBoolean("isApprovedBrowser"))
        assertEquals("com.android.chrome", w0.getString("packageName"))
    }
}
