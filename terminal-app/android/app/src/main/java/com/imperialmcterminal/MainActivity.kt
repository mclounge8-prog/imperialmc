package com.imperialmcterminal

import android.os.Bundle
import android.os.Build
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  private var kioskLocked: Boolean = BuildConfig.IS_KIOSK

  fun setKioskLocked(locked: Boolean) {
    kioskLocked = locked
    if (locked) {
      hideSystemNavigation()
      window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      showSystemNavigation()
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String =
      if (BuildConfig.IS_KIOSK) "ImperialMcKiosk" else "ImperialMcTerminal"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (BuildConfig.IS_KIOSK) {
      window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      hideSystemNavigation()
      onBackPressedDispatcher.addCallback(
        this,
        object : OnBackPressedCallback(true) {
          override fun handleOnBackPressed() {
            if (!kioskLocked) {
              isEnabled = false
              onBackPressedDispatcher.onBackPressed()
              isEnabled = true
            }
          }
        }
      )
      @Suppress("DEPRECATION")
      window.decorView.setOnSystemUiVisibilityChangeListener {
        if (kioskLocked) hideSystemNavigation()
      }
    }
  }

  override fun invokeDefaultOnBackPressed() {
    if (BuildConfig.IS_KIOSK && kioskLocked) return
    super.invokeDefaultOnBackPressed()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && BuildConfig.IS_KIOSK && kioskLocked) {
      hideSystemNavigation()
    }
  }

  override fun onResume() {
    super.onResume()
    if (BuildConfig.IS_KIOSK && kioskLocked) hideSystemNavigation()
  }

  private fun showSystemNavigation() {
    WindowCompat.setDecorFitsSystemWindows(window, true)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.show(WindowInsetsCompat.Type.navigationBars())
  }

  /**
   * Прячет навбар без свайпа снизу. Вернуть кнопки можно только из настроек киоска
   * (5 нажатий на название заведения).
   */
  private fun hideSystemNavigation() {
    if (!BuildConfig.IS_KIOSK) return
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.hide(WindowInsetsCompat.Type.navigationBars())
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          or View.SYSTEM_UI_FLAG_IMMERSIVE
          or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      )
    }
  }
}
