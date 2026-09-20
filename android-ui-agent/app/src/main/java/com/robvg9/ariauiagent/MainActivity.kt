package com.robvg9.ariauiagent

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }

        val title = TextView(this).apply {
            text = "ARIA · Android UI Agent"
            textSize = 24f
            setPadding(0, 0, 0, 18)
        }

        status = TextView(this).apply {
            text = serviceStatus()
            setPadding(0, 0, 0, 28)
        }

        val accessibility = Button(this).apply {
            text = "Abrir Accesibilidad de Android"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }

        val openPwa = Button(this).apply {
            text = "Abrir ARIA PWA"
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pwaUrl)))
            }
        }

        val refresh = Button(this).apply {
            text = "Actualizar estado"
            setOnClickListener { status.text = serviceStatus() }
        }

        root.addView(title)
        root.addView(status)
        root.addView(accessibility)
        root.addView(openPwa)
        root.addView(refresh)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) status.text = serviceStatus()
    }

    private fun serviceStatus(): String =
        if (AriaAccessibilityService.instance == null) {
            "Estado: ACCESIBILIDAD DESHABILITADA"
        } else {
            "Estado: LISTA · control visual Android habilitado"
        }
}
