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
}
