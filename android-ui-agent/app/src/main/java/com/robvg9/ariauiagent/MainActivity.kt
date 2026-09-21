package com.robvg9.ariauiagent

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.viewpager2.widget.ViewPager2
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.adapter.FragmentStateAdapter
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.widget.MarginPageTransformer

/**
 * UI principal con ViewPager2 para navegación entre Dashboard y Chat.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var viewPager: ViewPager2
    private lateinit var indicatorLayout: LinearLayout
    private lateinit var store: LocalMissionStore
    private lateinit var runner: LocalMissionRunner

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        store = LocalMissionStore(applicationContext)
        runner = LocalMissionRunner(store) { mission ->
            // Actualización global si es necesario
        }

        val root = FrameLayout(this)
        viewPager = ViewPager2(this).apply {
            id = View.generateViewId()
            adapter = MainPagerAdapter(this@MainActivity)
            setPageTransformer(MarginPageTransformer(20))
        }
        root.addView(viewPager)

        indicatorLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 50)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            )
        }
        root.addView(indicatorLayout)
        
        updateIndicators(0)
        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                updateIndicators(position)
            }
        })

        setContentView(root)
    }

    private fun updateIndicators(position: Int) {
        indicatorLayout.removeAllViews()
        for (i in 0 until 2) {
            val dot = TextView(this).apply {
                text = if (i == position) "●" else "○"
                textSize = 20f
                setPadding(10, 0, 10, 0)
            }
            indicatorLayout.addView(dot)
        }
    }

    private inner class MainPagerAdapter(fa: FragmentActivity) : FragmentStateAdapter(fa) {
        override fun getItemCount(): Int = 2
        override fun createFragment(position: Int): Fragment {
            return if (position == 0) DashboardFragment() else ChatFragment()
        }
    }
}

class DashboardFragment : Fragment() {
    override fun onCreateView(inflater: android.view.LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val layout = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 50, 50, 50)
        }
        layout.addView(TextView(requireContext()).apply { text = "Dashboard Principal" })
        return layout
    }
}

class ChatFragment : Fragment() {
    override fun onCreateView(inflater: android.view.LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val layout = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 50, 50, 50)
        }
        layout.addView(TextView(requireContext()).apply { text = "Chat (2da Pantalla)" })
        return layout
    }
}
