package com.robvg9.ariauiagent

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.ViewFlipper
import androidx.appcompat.app.AppCompatActivity

/**
 * Visible owner control surface for local missions.
 * Now with a ViewFlipper for Dashboard (Screen 1) and Chat (Screen 2).
 */
class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"

    private lateinit var statusText: TextView
    private lateinit var missionText: TextView
    private lateinit var actionText: TextView
    private lateinit var logText: TextView
    private lateinit var flipper: ViewFlipper

    private lateinit var store: LocalMissionStore
    private lateinit var runner: LocalMissionRunner

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        store = LocalMissionStore(applicationContext)
        runner = LocalMissionRunner(store) { mission ->
            runOnUiThread { render(mission) }
        }

        flipper = ViewFlipper(this)

        // Screen 1: Dashboard
        val dashboard = ScrollView(this)
        val dashRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 48, 40, 48)
        }
        
        val title = TextView(this).apply {
            text = "ARIA · Dashboard"
            textSize = 22f
            setPadding(0, 0, 0, 12)
        }
        statusText = TextView(this).apply { textSize = 14f; setPadding(0, 0, 0, 8) }
        val btnNext = Button(this).apply {
            text = "Ir a Chat →"
            setOnClickListener {
                flipper.setInAnimation(this@MainActivity, android.R.anim.slide_in_left)
                flipper.setOutAnimation(this@MainActivity, android.R.anim.slide_out_right)
                flipper.showNext()
            }
        }
        dashRoot.addView(title)
        dashRoot.addView(statusText)
        dashRoot.addView(btnNext)
        dashboard.addView(dashRoot)

        // Screen 2: Chat
        val chat = ScrollView(this)
        val chatRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 48, 40, 48)
        }
        val chatTitle = TextView(this).apply { text = "ARIA · Chat"; textSize = 22f }
        missionText = TextView(this).apply { textSize = 13f; setPadding(0, 0, 0, 8) }
        actionText = TextView(this).apply { textSize = 13f; setPadding(0, 0, 0, 12) }
        logText = TextView(this).apply { textSize = 12f; setPadding(0, 8, 0, 12) }
        
        val btnPrev = Button(this).apply {
            text = "← Volver a Dashboard"
            setOnClickListener {
                flipper.setInAnimation(this@MainActivity, android.R.anim.slide_in_left)
                flipper.setOutAnimation(this@MainActivity, android.R.anim.slide_out_right)
                flipper.showPrevious()
            }
        }
        
        // Add existing buttons to Chat
        val btnStart = Button(this).apply { text = "Iniciar misión"; setOnClickListener { runner.startMission("Misión local ARIA") } }
        val btnApprove = Button(this).apply { text = "✓ APROBAR"; setOnClickListener { runner.approveAndExecute() } }
        
        chatRoot.addView(chatTitle)
        chatRoot.addView(btnPrev)
        chatRoot.addView(missionText)
        chatRoot.addView(actionText)
        chatRoot.addView(btnStart)
        chatRoot.addView(btnApprove)
        chatRoot.addView(logText)
        chat.addView(chatRoot)

        flipper.addView(dashboard)
        flipper.addView(chat)
        setContentView(flipper)

        render(runner.current() ?: LocalMission(state = MissionState.IDLE, title = "(sin misión)"))
    }

    private fun render(m: LocalMission) {
        statusText.text = "Servicio: ${if (AriaAccessibilityService.instance == null) "DESHABILITADO" else "ACTIVO"}"
        missionText.text = "Misión: ${m.title}\nEstado: ${m.state}"
        actionText.text = if (m.proposedAction != null) "ACCIÓN PENDIENTE" else "Sin acción."
    }
}
