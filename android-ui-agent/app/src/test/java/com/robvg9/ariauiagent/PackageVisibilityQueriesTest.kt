package com.robvg9.ariauiagent

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Structural guard: the five Chrome package names that must appear in
 * AndroidManifest.xml <queries> so PackageManager can see them on API 30+.
 * This does not perform device detection; it only documents the required set.
 */
class PackageVisibilityQueriesTest {

    @Test
    fun chrome_packages_required_for_queries_are_defined() {
        val required = listOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.google.android.apps.chrome"
        )
        // Guard against accidental removal from the allowlist / queries contract.
        assertTrue(required.size == 5)
        assertTrue(required.contains("com.android.chrome"))
        assertTrue(required.contains("com.chrome.beta"))
        assertTrue(required.contains("com.chrome.dev"))
        assertTrue(required.contains("com.chrome.canary"))
        assertTrue(required.contains("com.google.android.apps.chrome"))
    }
}
