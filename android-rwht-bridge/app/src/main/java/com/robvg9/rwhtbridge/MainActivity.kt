package com.robvg9.rwhtbridge

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }

        val title = TextView(this).apply {
            text = "ARIA · RWHT Android Bridge"
            textSize = 24f
            setPadding(0, 0, 0, 20)
        }

        val status = TextView(this).apply {
            text = "Bridge local: 127.0.0.1:43817"
            setPadding(0, 0, 0, 32)
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

        val health = Button(this).apply {
            text = "Comprobar estado del Bridge"
            setOnClickListener {
                val service = AriaAccessibilityService.instance
                status.text = if (service == null) {
                    "Bridge: SERVICIO NO HABILITADO"
                } else {
                    "Bridge: ONLINE · loopback 127.0.0.1:43817"
                }
            }
        }

        root.addView(title)
        root.addView(status)
        root.addView(accessibility)
        root.addView(openPwa)
        root.addView(health)

        setContentView(root)
    }
}
