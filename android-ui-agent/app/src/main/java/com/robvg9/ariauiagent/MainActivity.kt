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
import android.view.ViewGroup
import java.util.concurrent.Executors

/**
 * ARIA UI Agent: Dashboard + Chat (ViewPager2)
 */
class MainActivity : AppCompatActivity() {
    private val pwaUrl = "https://aria.robvg9.workers.dev/pwa/"
    private val approveExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var viewPager: ViewPager2
    private lateinit var indicator: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val root = FrameLayout(this)
        
        viewPager = ViewPager2(this).apply {
            id = View.generateViewId()
            adapter = MainPagerAdapter(this@MainActivity)
        }
        
        indicator = TextView(this).apply {
            text = "● ○"
            textSize = 20f
            gravity = Gravity.CENTER
            setPadding(0, 50, 0, 0)
        }

        root.addView(viewPager)
        root.addView(indicator, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ))

        setContentView(root)

        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                indicator.text = if (position == 0) "● ○" else "○ ●"
            }
        })
    }
}

class MainPagerAdapter(private val activity: MainActivity) : RecyclerView.Adapter<MainPagerAdapter.ViewHolder>() {
    override fun getItemCount() = 2

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val scroll = ScrollView(parent.context)
        val layout = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 100, 40, 40)
        }
        scroll.addView(layout)
        return ViewHolder(scroll, layout)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.layout.removeAllViews()
        if (position == 0) {
            holder.layout.addView(TextView(holder.layout.context).apply { text = "DASHBOARD"; textSize = 24f })
            holder.layout.addView(Button(holder.layout.context).apply { text = "Estado del Sistema" })
        } else {
            holder.layout.addView(TextView(holder.layout.context).apply { text = "CHAT"; textSize = 24f })
            holder.layout.addView(TextView(holder.layout.context).apply { text = "Próximamente: Interfaz de Chat" })
        }
    }

    class ViewHolder(val view: View, val layout: LinearLayout) : RecyclerView.ViewHolder(view)
}
