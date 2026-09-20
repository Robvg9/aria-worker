package com.robvg9.ariauiagent

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.viewpager2.widget.ViewPager2
import androidx.viewpager2.adapter.FragmentStateAdapter
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.widget.ViewPager2.OnPageChangeCallback

/**
 * Dashboard principal con navegación deslizable.
 * Pantalla 1: Dashboard de control.
 * Pantalla 2: Chat.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var viewPager: ViewPager2
    private lateinit var indicatorText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)
        
        viewPager = ViewPager2(this).apply {
            id = android.view.View.generateViewId()
            adapter = ScreenAdapter(this@MainActivity)
        }
        
        indicatorText = TextView(this).apply {
            text = "← Dashboard | Chat →"
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 20)
            textSize = 16f
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(indicatorText)
            addView(viewPager)
        }
        
        root.addView(container)
        setContentView(root)

        viewPager.registerOnPageChangeCallback(object : OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                indicatorText.text = if (position == 0) "← Dashboard | Chat →" else "← Dashboard | Chat →"
            }
        })
    }
}

class ScreenAdapter(activity: FragmentActivity) : FragmentStateAdapter(activity) {
    override fun getItemCount(): Int = 2
    override fun createFragment(position: Int): Fragment {
        return if (position == 0) DashboardFragment() else ChatFragment()
    }
}

class DashboardFragment : Fragment() {
    override fun onCreateView(inflater: android.view.LayoutInflater, container: android.view.ViewGroup?, savedInstanceState: Bundle?): android.view.View {
        val scroll = ScrollView(requireContext())
        val layout = LinearLayout(requireContext()).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 40, 40, 40) }
        layout.addView(TextView(requireContext()).apply { text = "Dashboard Principal"; textSize = 20f })
        // Aquí irían los botones de control del MainActivity original
        scroll.addView(layout)
        return scroll
    }
}

class ChatFragment : Fragment() {
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: android.view.ViewGroup?,
        savedInstanceState: Bundle?
    ): android.view.View {
        val webView = android.webkit.WebView(requireContext()).apply {
            webViewClient = android.webkit.WebViewClient()
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadsImagesAutomatically = true
            loadUrl("https://aria.robvg9.workers.dev/pwa/")
        }
        return webView
    }

    override fun onDestroyView() {
        (view as? android.webkit.WebView)?.destroy()
        super.onDestroyView()
    }
}
