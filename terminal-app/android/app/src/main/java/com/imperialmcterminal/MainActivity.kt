package com.imperialmcterminal

import android.os.Bundle
import android.os.Build
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "ImperialMcTerminal"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    hideSystemNavigation()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // После диалогов/клавиатуры Android снова показывает навбар —
    // возвращаем immersive, как только окно снова в фокусе.
    if (hasFocus) {
      hideSystemNavigation()
    }
  }

  override fun onResume() {
    super.onResume()
    hideSystemNavigation()
  }

  /**
   * Скрывает системную панель навигации (3 кнопки Back/Home/Recents).
   * Появляется временно по свайпу от нижнего края экрана вверх
   * (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE) и снова прячется.
   */
  private fun hideSystemNavigation() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.hide(WindowInsetsCompat.Type.navigationBars())
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

    // На старых API дополнительно через systemUiVisibility-флаги.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          or android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      )
    }
  }
}
