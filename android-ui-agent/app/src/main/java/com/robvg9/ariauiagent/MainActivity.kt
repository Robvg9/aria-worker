package com.robvg9.ariauiagent

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.Executors

/**
 * Visible owner control surface for local missions.
 * No action is executed without explicit Approve.
 *
 * Official flow:
 * 1. Iniciar misión → 2. Modo observación (overlay) → OBSERVAR en overlay →
 * 3. Proponer → 4. APROBAR y ejecutar (handoff: ARIA → background, Chrome foreground)
 */
class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"
    private val approveExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var statusText: TextView
    private lateinit var missionText: TextView
    private lateinit var actionText: TextView
    private lateinit var diagText: TextView
    private lateinit var logText: TextView
    private lateinit var copyFeedback: TextView

    private lateinit var btnStart: Button
    private lateinit var btnWaitingObserve: Button
    private lateinit var btnObserveLegacy: Button
    private lateinit var btnProposeDemo: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnCancel: Button
    private lateinit var btnCopyAll: Button
    private lateinit var btnClear: Button
    private lateinit var btnAccessibility: Button
    private lateinit var btnAppInfo: Button
    private lateinit var btnPwa: Button

    private lateinit var contentRoot: LinearLayout
    private lateinit var store: LocalMissionStore
    private lateinit var runner: LocalMissionRunner

    @Volatile private var approveInFlight: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        store = LocalMissionStore(applicationContext)
        runner = LocalMissionRunner(store) { mission ->
            runOnUiThread { render(mission) }
        }

        val scroll = ScrollView(this)
        contentRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 24, 40, 24)
        }

        val title = TextView(this).apply {
            text = "ARIA · Local Mission Runner"
            textSize = 22f
            setPadding(0, 0, 0, 12)
        }

        statusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, 0, 0, 8)
        }
        missionText = TextView(this).apply {
            textSize = 13f
            setPadding(0, 0, 0, 8)
        }
        actionText = TextView(this).apply {
            textSize = 13f
            setPadding(0, 0, 0, 12)
        }
        diagText = TextView(this).apply {
            textSize = 12f
            setPadding(20, 16, 20, 16)
            setBackgroundColor(android.graphics.Color.rgb(18, 58, 42))
            visibility = TextView.GONE
        }
        logText = TextView(this).apply {
            textSize = 12f
            setPadding(0, 8, 0, 12)
        }
        copyFeedback = TextView(this).apply {
            textSize = 14f
            setTextColor(android.graphics.Color.rgb(80, 220, 140))
            visibility = TextView.GONE
            setPadding(0, 8, 0, 8)
        }

        btnStart = Button(this).apply {
            text = "1. Iniciar misión local"
            setOnClickListener {
                val m = runner.startMission("Misión local ARIA")
                appendLog("start → ${m.missionId.take(8)} state=${m.state}")
            }
        }
        btnWaitingObserve = Button(this).apply {
            text = "2. Modo observación (overlay)"
            setOnClickListener {
                val m = runner.enterWaitingObserve()
                appendLog("waiting_observe → state=${m.state} err=${m.lastError ?: "-"}")
                appendLog("→ Abre Chrome; pulsa OBSERVAR en el overlay ARIA")
            }
        }
        btnObserveLegacy = Button(this).apply {
            text = "[LEGACY/DEBUG] Observe desde Activity (roba foco)"
            setOnClickListener {
                val m = runner.runObserve()
                appendLog("observe_activity_legacy → state=${m.state} err=${m.lastError ?: "-"}")
            }
        }
        btnProposeDemo = Button(this).apply {
            text = "3. PROPONER ACCIÓN (WAIT 500ms)"
            setOnClickListener {
                val m = runner.proposeAction(
                    actionType = "wait",
                    params = mapOf("ms" to 500L)
                )
                appendLog("propose → state=${m.state} action=wait ms=500")
            }
        }
        btnApprove = Button(this).apply {
            text = "✓ APROBAR y ejecutar"
            setOnClickListener { onApproveClicked() }
        }
        btnReject = Button(this).apply {
            text = "✗ Rechazar acción"
            setOnClickListener {
                val m = runner.reject()
                appendLog("reject → state=${m.state}")
            }
        }
        btnCancel = Button(this).apply {
            text = "⏹ Cancelar misión"
            setOnClickListener {
                val m = runner.cancel()
                appendLog("cancel → state=${m.state}")
            }
        }
        btnCopyAll = Button(this).apply {
            text = "COPIAR TODO"
            setOnClickListener { copyAllVisibleContent() }
        }
        btnClear = Button(this).apply {
            text = "Limpiar misión"
            setOnClickListener {
                runner.clear()
                appendLog("cleared")
            }
        }
        btnAccessibility = Button(this).apply {
            text = "ACCESIBILIDAD"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        btnAppInfo = Button(this).apply {
            text = "INFORMACIÓN DE LA APLICACIÓN"
            setOnClickListener { openAppDetailsSettings() }
        }
        btnPwa = Button(this).apply {
            text = "Abrir ARIA PWA"
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pwaUrl)))
            }
        }

        contentRoot.addView(title)
        contentRoot.addView(statusText)
        contentRoot.addView(missionText)
        contentRoot.addView(actionText)
        contentRoot.addView(diagText)
        contentRoot.addView(btnStart)
        contentRoot.addView(btnWaitingObserve)
        contentRoot.addView(btnProposeDemo)
        contentRoot.addView(btnApprove)
        contentRoot.addView(btnReject)
        contentRoot.addView(btnCancel)
        contentRoot.addView(btnCopyAll)
        contentRoot.addView(copyFeedback)
        contentRoot.addView(btnClear)
        contentRoot.addView(btnObserveLegacy)
        contentRoot.addView(btnAccessibility)
        contentRoot.addView(btnAppInfo)
        contentRoot.addView(btnPwa)
        contentRoot.addView(logText)
        scroll.addView(contentRoot)
        setContentView(scroll)

        applySystemBarInsets(scroll, contentRoot)

        val recovered = runner.recover()
        if (recovered != null) {
            appendLog("recover → state=${recovered.state} err=${recovered.lastError ?: "-"}")
            render(recovered)
        } else {
            render(LocalMission(state = MissionState.IDLE, title = "(sin misión)"))
        }
    }

    /**
     * Human Gate approve with foreground handoff:
     * 1. User explicitly approved (button press)
     * 2. moveTaskToBack — ARIA leaves foreground without finish/kill
     * 3. Settle so Chrome can become TYPE_APPLICATION active
     * 4. approveAndExecute on background thread (AccessibilityService + windows_scan)
     * 5. State persisted; user sees COMPLETE/FAILED when returning to ARIA (onResume)
     */
    private fun onApproveClicked() {
        if (approveInFlight) {
            appendLog("approve → ignored (already in flight)")
            return
        }
        val current = runner.current()
        if (current?.state != MissionState.PENDING_APPROVAL) {
            appendLog("approve → not_pending_approval")
            return
        }
        approveInFlight = true
        btnApprove.isEnabled = false
        appendLog("approve → foregroundBeforeAction package=$packageName")
        appendLog("approve → handoff moveTaskToBack(true)")

        // Leave foreground so Chrome (previous app) can become active window.
        moveTaskToBack(true)

        approveExecutor.execute {
            try {
                // Settle: allow system to restore Chrome as TYPE_APPLICATION active.
                Thread.sleep(HANDOFF_SETTLE_MS)
                appendLogSafe("approve → foregroundBeforeExecution (after settle ${HANDOFF_SETTLE_MS}ms)")
                val m = runner.approveAndExecute()
                appendLogSafe(
                    "approve+exec → state=${m.state} err=${m.lastError ?: "-"} " +
                        "handoff=moveTaskToBack settleMs=$HANDOFF_SETTLE_MS"
                )
                mainHandler.post {
                    approveInFlight = false
                    render(m)
                }
            } catch (e: Exception) {
                appendLogSafe("approve+exec → exception ${e.message?.take(80)}")
                mainHandler.post {
                    approveInFlight = false
                    render(runner.current() ?: LocalMission(state = MissionState.FAILED, lastError = e.message))
                }
            }
        }
    }

    private fun appendLogSafe(line: String) {
        mainHandler.post { appendLog(line) }
    }

    private fun openAppDetailsSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            appendLog("app_info → opened package=$packageName")
        } catch (e: ActivityNotFoundException) {
            appendLog("app_info → ActivityNotFoundException")
        } catch (e: Exception) {
            appendLog("app_info → error: ${e.message?.take(60)}")
        }
    }

    private fun applySystemBarInsets(scroll: ScrollView, content: LinearLayout) {
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val baseH = (40 * resources.displayMetrics.density).toInt()
            val baseV = (24 * resources.displayMetrics.density).toInt()
            content.setPadding(
                baseH + bars.left,
                baseV + bars.top,
                baseH + bars.right,
                baseV + bars.bottom
            )
            insets
        }
        ViewCompat.requestApplyInsets(scroll)
    }

    override fun onResume() {
        super.onResume()
        render(runner.current() ?: LocalMission(state = MissionState.IDLE, title = "(sin misión)"))
    }

    override fun onDestroy() {
        approveExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun render(m: LocalMission) {
        val a11y = if (AriaAccessibilityService.instance == null) {
            "ACCESIBILIDAD DESHABILITADA"
        } else {
            "ACCESIBILIDAD ACTIVA"
        }
        statusText.text = "Servicio: $a11y"

        val stateLabel = when (m.state) {
            MissionState.WAITING_OBSERVE -> "ESPERANDO OBSERVACIÓN (overlay activo)"
            MissionState.PENDING_APPROVAL -> "PENDIENTE DE APROBACIÓN"
            MissionState.ACTION -> "EJECUTANDO (handoff / Chrome foreground)"
            else -> m.state.name
        }

        missionText.text = buildString {
            append("Misión: ${m.title}\n")
            append("ID: ${m.missionId.take(8)}…\n")
            append("Estado: $stateLabel\n")
            append("Pasos: ${m.steps.size}\n")
            if (m.lastError != null) append("Error: ${m.lastError}\n")
            if (m.cancelledByOwner) append("(cancelada por el propietario)\n")
            if (m.state == MissionState.WAITING_OBSERVE) {
                append("\n→ Cambia a Chrome. El panel ARIA flota encima.\n")
                append("→ Pulsa OBSERVAR en el overlay (no en esta Activity).\n")
            }
            if (m.state == MissionState.PENDING_APPROVAL) {
                append("\n→ APROBAR hará handoff: ARIA al fondo, Chrome foreground.\n")
            }
        }

        val diagnostic = m.steps.asReversed()
            .firstOrNull { it.kind == StepKind.OBSERVE }
            ?.observation
            ?.diagnosticJson

        if (!diagnostic.isNullOrBlank()) {
            diagText.visibility = TextView.VISIBLE
            diagText.text = formatBrowserDiag(diagnostic)
        } else {
            diagText.visibility = TextView.GONE
            diagText.text = ""
        }

        val proposed = m.proposedAction
        actionText.text = if (proposed != null) {
            buildString {
                append("PROPUESTA — NO EJECUTADA\n")
                append("tipo: ${proposed.actionType}\n")
                if (proposed.targetNodeId != null) append("node: ${proposed.targetNodeId}\n")
                if (proposed.params.isNotEmpty()) append("params: ${proposed.params}\n")
                append("Human Gate: PENDIENTE DE APROBACIÓN EXPLÍCITA\n")
                append("→ Usa APROBAR o Rechazar")
            }
        } else {
            "Sin acción pendiente.\nHuman Gate: sin propuesta activa."
        }

        val pending = m.state == MissionState.PENDING_APPROVAL && !approveInFlight
        btnApprove.isEnabled = pending
        btnReject.isEnabled = pending
        btnCancel.isEnabled = m.state != MissionState.COMPLETE &&
            m.state != MissionState.CANCELLED &&
            m.state != MissionState.IDLE
        val canObserve = m.state != MissionState.PENDING_APPROVAL &&
            m.state != MissionState.COMPLETE &&
            m.state != MissionState.CANCELLED &&
            m.state != MissionState.IDLE &&
            m.state != MissionState.ACTION
        btnWaitingObserve.isEnabled = canObserve || m.state == MissionState.IDLE
        btnObserveLegacy.isEnabled = canObserve || m.state == MissionState.IDLE
        btnProposeDemo.isEnabled = ProposeGate.canPropose(m)

        val lastEvidence = m.steps.asReversed().firstOrNull { it.kind == StepKind.EVIDENCE }?.evidence
        if (lastEvidence != null && m.state == MissionState.COMPLETE) {
            appendLog("evidence chainHash=${lastEvidence.chainHash.take(16)}…")
        }
    }

    private fun copyAllVisibleContent() {
        val m = runner.current() ?: LocalMission(state = MissionState.IDLE, title = "(sin misión)")
        val a11y = if (AriaAccessibilityService.instance == null) {
            "ACCESIBILIDAD DESHABILITADA"
        } else {
            "ACCESIBILIDAD ACTIVA"
        }
        val stateLabel = when (m.state) {
            MissionState.WAITING_OBSERVE -> "ESPERANDO OBSERVACIÓN (overlay activo)"
            MissionState.PENDING_APPROVAL -> "PENDIENTE DE APROBACIÓN"
            else -> m.state.name
        }
        val proposed = m.proposedAction
        val diagnostic = m.steps.asReversed()
            .firstOrNull { it.kind == StepKind.OBSERVE }
            ?.observation
            ?.diagnosticJson

        val text = buildString {
            appendLine("ARIA LOCAL MISSION RUNNER")
            appendLine()
            appendLine("Servicio: $a11y")
            appendLine("Misión: ${m.title}")
            appendLine("ID: ${m.missionId}")
            appendLine("Estado: $stateLabel")
            appendLine("Pasos: ${m.steps.size}")
            if (m.lastError != null) appendLine("Error: ${m.lastError}")
            if (m.cancelledByOwner) appendLine("(cancelada por el propietario)")
            appendLine()
            appendLine("HUMAN GATE")
            if (proposed != null) {
                appendLine("Estado: PENDIENTE DE APROBACIÓN EXPLÍCITA")
                appendLine("Propuesta tipo: ${proposed.actionType}")
                if (proposed.targetNodeId != null) appendLine("node: ${proposed.targetNodeId}")
                if (proposed.params.isNotEmpty()) appendLine("params: ${proposed.params}")
                appendLine("approved: ${proposed.approved}")
            } else {
                appendLine("Estado: sin propuesta activa")
            }
            appendLine()
            appendLine("ACCIONES DISPONIBLES")
            appendLine("1. Iniciar misión local")
            appendLine("2. Modo observación (overlay)  ← flujo oficial")
            appendLine("3. PROPONER ACCIÓN (WAIT 500ms)")
            appendLine("✓ APROBAR y ejecutar (handoff foreground)")
            appendLine("✗ Rechazar / ⏹ Cancelar")
            appendLine("COPIAR TODO")
            appendLine("ACCESIBILIDAD / INFORMACIÓN DE LA APLICACIÓN")
            appendLine("[LEGACY/DEBUG] Observe Activity (no usar en flujo oficial)")
            appendLine()
            appendLine("DIAGNÓSTICO ANDROID")
            if (!diagnostic.isNullOrBlank()) {
                appendLine(formatBrowserDiag(diagnostic))
            } else {
                appendLine("(sin diagnóstico de observe aún)")
            }
            appendLine()
            appendLine("LOG")
            val log = logText.text?.toString().orEmpty().trim()
            if (log.isEmpty()) appendLine("(vacío)") else appendLine(log)
        }

        val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("ARIA Local Mission", text))
        copyFeedback.visibility = View.VISIBLE
        copyFeedback.text = "✓ CONTENIDO COPIADO"
        copyFeedback.postDelayed({
            if (copyFeedback.text == "✓ CONTENIDO COPIADO") {
                copyFeedback.visibility = View.GONE
            }
        }, 2500)
        appendLog("copy_all → clipboard (${text.length} chars)")
    }

    private fun formatBrowserDiag(raw: String): String {
        return runCatching {
            val o = org.json.JSONObject(raw)
            buildString {
                append("══ DIAGNÓSTICO ANDROID REAL ══\n")
                val scalarKeys = listOf(
                    "activePackage", "activeIsBrowser", "installedApprovedBrowsers",
                    "windowsNull", "windowCount", "applicationWindowCount",
                    "applicationWindowsWithRoot", "source", "hint",
                    "resolvePhase", "resolveAttempt", "preferWindowsScan"
                )
                scalarKeys.forEach { key ->
                    if (o.has(key)) append("$key: ${o.opt(key)}\n")
                }
                append("── windows[] ──\n")
                val windows = o.optJSONArray("windows")
                if (windows == null || windows.length() == 0) {
                    append("(sin ventanas reportadas)\n")
                } else {
                    for (i in 0 until windows.length()) {
                        val w = windows.optJSONObject(i) ?: continue
                        append("[$i] type=${w.opt("type")} layer=${w.opt("layer")} id=${w.opt("id")}\n")
                        append("    isActive=${w.opt("isActive")} isFocused=${w.opt("isFocused")}\n")
                        append("    hasRoot=${w.opt("hasRoot")} isApprovedBrowser=${w.opt("isApprovedBrowser")}\n")
                        append("    packageName=${w.opt("packageName")}\n")
                    }
                }
                append("════════════════════════════")
            }
        }.getOrElse { "══ DIAGNÓSTICO ANDROID REAL ══\n$raw" }
    }

    private fun appendLog(line: String) {
        val prev = logText.text?.toString().orEmpty()
        val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date())
        logText.text = "$prev\n[$ts] $line".trim()
    }

    companion object {
        /** Settle after moveTaskToBack so Chrome can become active TYPE_APPLICATION. */
        const val HANDOFF_SETTLE_MS = 450L
    }
}

object ProposeGate {
    fun canPropose(m: LocalMission): Boolean {
        if (m.state == MissionState.PENDING_APPROVAL) return false
        if (m.state == MissionState.COMPLETE) return false
        if (m.state == MissionState.CANCELLED) return false
        if (m.state == MissionState.WAITING_OBSERVE) return false
        if (m.state == MissionState.ACTION) return false
        if (m.steps.isEmpty()) return false
        val last = m.steps.last()
        if (last.kind != StepKind.OBSERVE) return false
        return last.observation?.ok == true
    }
}
