package com.robvg9.ariauiagent

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Visible owner control surface for local missions.
 * No action is executed without explicit Approve.
 */
class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"

    private lateinit var statusText: TextView
    private lateinit var missionText: TextView
    private lateinit var actionText: TextView
    private lateinit var diagText: TextView
    private lateinit var logText: TextView

    private lateinit var btnStart: Button
    private lateinit var btnObserve: Button
    private lateinit var btnProposeDemo: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnCancel: Button
    private lateinit var btnClear: Button
    private lateinit var btnAccessibility: Button
    private lateinit var btnPwa: Button

    private lateinit var store: LocalMissionStore
    private lateinit var runner: LocalMissionRunner

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        store = LocalMissionStore(applicationContext)
        runner = LocalMissionRunner(store) { mission ->
            runOnUiThread { render(mission) }
        }

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 48, 40, 48)
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

        btnStart = Button(this).apply {
            text = "1. Iniciar misión local"
            setOnClickListener {
                val m = runner.startMission("Misión local ARIA")
                appendLog("start → ${m.missionId.take(8)} state=${m.state}")
            }
        }
        btnObserve = Button(this).apply {
            text = "2. Observe (sin aprobación)"
            setOnClickListener {
                val m = runner.runObserve()
                appendLog("observe → state=${m.state} err=${m.lastError ?: "-"}")
            }
        }
        btnProposeDemo = Button(this).apply {
            text = "3. Proponer acción (demo: back)"
            setOnClickListener {
                val m = runner.proposeAction(
                    actionType = "press",
                    params = mapOf("keyCode" to android.view.KeyEvent.KEYCODE_BACK)
                )
                appendLog("propose → state=${m.state}")
            }
        }
        btnApprove = Button(this).apply {
            text = "✓ APROBAR y ejecutar"
            setOnClickListener {
                val m = runner.approveAndExecute()
                appendLog("approve+exec → state=${m.state} err=${m.lastError ?: "-"}")
            }
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
        btnClear = Button(this).apply {
            text = "Limpiar misión"
            setOnClickListener {
                runner.clear()
                appendLog("cleared")
            }
        }
        btnAccessibility = Button(this).apply {
            text = "Abrir Accesibilidad de Android"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        btnPwa = Button(this).apply {
            text = "Abrir ARIA PWA"
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pwaUrl)))
            }
        }

        root.addView(title)
        root.addView(statusText)
        root.addView(missionText)
        root.addView(actionText)
        root.addView(diagText)
        root.addView(btnStart)
        root.addView(btnObserve)
        root.addView(btnProposeDemo)
        root.addView(btnApprove)
        root.addView(btnReject)
        root.addView(btnCancel)
        root.addView(btnClear)
        root.addView(btnAccessibility)
        root.addView(btnPwa)
        root.addView(logText)
        scroll.addView(root)
        setContentView(scroll)

        val recovered = runner.recover()
        if (recovered != null) {
            appendLog("recover → state=${recovered.state} err=${recovered.lastError ?: "-"}")
            render(recovered)
        } else {
            render(LocalMission(state = MissionState.IDLE, title = "(sin misión)"))
        }
    }

    override fun onResume() {
        super.onResume()
        render(runner.current() ?: LocalMission(state = MissionState.IDLE, title = "(sin misión)"))
    }

    private fun render(m: LocalMission) {
        val a11y = if (AriaAccessibilityService.instance == null) {
            "ACCESIBILIDAD DESHABILITADA"
        } else {
            "ACCESIBILIDAD ACTIVA"
        }
        statusText.text = "Servicio: $a11y"

        missionText.text = buildString {
            append("Misión: ${m.title}\n")
            append("ID: ${m.missionId.take(8)}…\n")
            append("Estado: ${m.state}\n")
            append("Pasos: ${m.steps.size}\n")
            if (m.lastError != null) append("Error: ${m.lastError}\n")
            if (m.cancelledByOwner) append("(cancelada por el propietario)\n")
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
                append("ACCIÓN PENDIENTE DE APROBACIÓN\n")
                append("tipo: ${proposed.actionType}\n")
                if (proposed.targetNodeId != null) append("node: ${proposed.targetNodeId}\n")
                if (proposed.params.isNotEmpty()) append("params: ${proposed.params}\n")
                append("→ Usa APROBAR o Rechazar")
            }
        } else {
            "Sin acción pendiente."
        }

        val pending = m.state == MissionState.PENDING_APPROVAL
        btnApprove.isEnabled = pending
        btnReject.isEnabled = pending
        btnCancel.isEnabled = m.state != MissionState.COMPLETE &&
            m.state != MissionState.CANCELLED &&
            m.state != MissionState.IDLE
        btnObserve.isEnabled = m.state != MissionState.PENDING_APPROVAL &&
            m.state != MissionState.COMPLETE &&
            m.state != MissionState.CANCELLED
        btnProposeDemo.isEnabled = m.state != MissionState.PENDING_APPROVAL &&
            m.state != MissionState.COMPLETE &&
            m.state != MissionState.CANCELLED &&
            m.state != MissionState.IDLE

        val lastEvidence = m.steps.asReversed().firstOrNull { it.kind == StepKind.EVIDENCE }?.evidence
        if (lastEvidence != null && m.state == MissionState.COMPLETE) {
            appendLog("evidence chainHash=${lastEvidence.chainHash.take(16)}…")
        }
    }

    private fun formatBrowserDiag(raw: String): String {
        return runCatching {
            val o = org.json.JSONObject(raw)
            buildString {
                append("══ DIAGNÓSTICO ANDROID REAL ══\n")
                val scalarKeys = listOf(
                    "activePackage", "activeIsBrowser", "installedApprovedBrowsers",
                    "windowsNull", "windowCount", "applicationWindowCount",
                    "applicationWindowsWithRoot", "hint"
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
}
