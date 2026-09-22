package com.robvg9.ariauiagent

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.viewpager2.widget.ViewPager2
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2.Adapter
import android.view.ViewGroup
import java.util.concurrent.Executors

/**
 * ARIA UI Agent: Dashboard principal y Chat en 2da pantalla.
 */
class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"
    private val approveExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var statusText: TextView
    private lateinit var missionText: TextView
    private lateinit var actionText: TextView
    private lateinit var logText: TextView
    private lateinit var btnStart: Button
    private lateinit var btnWaitingObserve: Button
    private lateinit var btnProposeDemo: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnCancel: Button
    private lateinit var btnClear: Button
    private lateinit var btnAccessibility: Button
    private lateinit var btnAppInfo: Button
    private lateinit var btnPwa: Button

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

        val viewPager = ViewPager2(this)
        viewPager.adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount() = 2
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
                val scroll = ScrollView(parent.context)
                val layout = LinearLayout(parent.context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(40, 24, 40, 24)
                }
                scroll.addView(layout)
                return object : RecyclerView.ViewHolder(scroll) {}
            }
            override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                val layout = (holder.itemView as ScrollView).getChildAt(0) as LinearLayout
                layout.removeAllViews()
                if (position == 0) {
                    renderDashboard(layout)
                } else {
                    renderChat(layout)
                }
            }
        }

        setContentView(viewPager)

        val recovered = runner.recover()
        if (recovered != null) render(recovered)
    }

    private fun renderDashboard(layout: LinearLayout) {
        layout.addView(TextView(this).apply { text = "Dashboard Principal"; textSize = 20f })
        statusText = TextView(this)
        layout.addView(statusText)
        btnStart = Button(this).apply { text = "Iniciar misión"; setOnClickListener { runner.startMission("Misión") } }
        layout.addView(btnStart)
        btnWaitingObserve = Button(this).apply { text = "Modo observación"; setOnClickListener { runner.enterWaitingObserve() } }
        layout.addView(btnWaitingObserve)
        btnAccessibility = Button(this).apply { text = "Accesibilidad"; setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } }
        layout.addView(btnAccessibility)
    }

    private fun renderChat(layout: LinearLayout) {
        layout.addView(TextView(this).apply { text = "Chat (2da pantalla)"; textSize = 20f })
        missionText = TextView(this)
        layout.addView(missionText)
        actionText = TextView(this)
        layout.addView(actionText)
        btnProposeDemo = Button(this).apply { text = "Proponer"; setOnClickListener { runner.proposeAction("wait", mapOf("ms" to 500L)) } }
        layout.addView(btnProposeDemo)
        btnApprove = Button(this).apply { text = "Aprobar"; setOnClickListener { onApproveClicked() } }
        layout.addView(btnApprove)
        btnReject = Button(this).apply { text = "Rechazar"; setOnClickListener { runner.reject() } }
        layout.addView(btnReject)
        btnCancel = Button(this).apply { text = "Cancelar"; setOnClickListener { runner.cancel() } }
        layout.addView(btnCancel)
        logText = TextView(this)
        layout.addView(logText)
    }

    private fun render(m: LocalMission) {
        statusText.text = "Estado: ${m.state}"
        missionText.text = "Misión: ${m.title}"
        actionText.text = "Acción: ${m.lastError ?: "Ninguna"}"
    }

    private fun onApproveClicked() {
        if (approveInFlight) return
        approveInFlight = true
        moveTaskToBack(true)
        approveExecutor.execute {
            runner.approveAndExecute()
            approveInFlight = false
        }
    }
}
