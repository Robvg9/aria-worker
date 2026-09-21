package com.robvg9.ariauiagent

/**
 * Pure helpers for bringing the previously observed approved browser
 * to the foreground after ARIA leaves the foreground on approve.
 *
 * No ADB / Termux / broadcast — only Intent flag composition and
 * package selection from an existing successful OBSERVE step.
 */
object BrowserHandoff {

    /** Intent flags that prefer reordering an existing Chrome task to the front. */
    const val HANDOFF_INTENT_FLAGS: Int =
        android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
            android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or
            android.content.Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED

    const val HANDOFF_METHOD = "launch_intent_reorder_to_front"

    /** Max poll cycles after startActivity waiting for TYPE_APPLICATION root. */
    const val HANDOFF_POLL_ATTEMPTS = 15

    /** Delay between poll cycles (ms). */
    const val HANDOFF_POLL_DELAY_MS = 200L

    /**
     * Last successful OBSERVE step package, if any.
     * Used as the explicit handoff target (not launcher, not ARIA).
     */
    fun selectObservedBrowserPackage(steps: List<LocalStep>): String? {
        return steps.asReversed()
            .firstOrNull { it.kind == StepKind.OBSERVE && it.observation?.ok == true }
            ?.observation
            ?.packageName
            ?.takeIf { it.isNotBlank() }
    }

    fun isApprovedBrowser(packageName: String?, approved: Set<String>): Boolean {
        if (packageName.isNullOrBlank()) return false
        return approved.contains(packageName)
    }
}
