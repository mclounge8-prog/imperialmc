package com.imperialmcterminal.kiosk

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.imperialmcterminal.MainActivity

class KioskLockModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "KioskLock"

  @ReactMethod
  fun startLock(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Нет Activity")
      return
    }
    activity.runOnUiThread {
      try {
        (activity as? MainActivity)?.setKioskLocked(true)
        try {
          activity.startLockTask()
        } catch (_: Exception) {
          // Пиннинг может потребовать подтверждения — навбар всё равно скрыт.
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("LOCK_ERROR", e.message, e)
      }
    }
  }

  @ReactMethod
  fun stopLock(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Нет Activity")
      return
    }
    activity.runOnUiThread {
      try {
        try {
          activity.stopLockTask()
        } catch (_: Exception) {
          // Уже не в lock task.
        }
        (activity as? MainActivity)?.setKioskLocked(false)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("UNLOCK_ERROR", e.message, e)
      }
    }
  }
}
