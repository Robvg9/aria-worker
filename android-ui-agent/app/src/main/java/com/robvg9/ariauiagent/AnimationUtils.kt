package com.robvg9.ariauiagent

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator

/**
 * Utilidades para animaciones suaves en la interfaz de usuario de ARIA.
 */
object AnimationUtils {
    fun applySmoothSwipeAnimation(view: View) {
        val animatorX = ObjectAnimator.ofFloat(view, "translationX", -50f, 0f)
        val animatorAlpha = ObjectAnimator.ofFloat(view, "alpha", 0f, 1f)
        
        AnimatorSet().apply {
            playTogether(animatorX, animatorAlpha)
            duration = 300
            interpolator = AccelerateDecelerateInterpolator()
            start()
        }
    }
}
