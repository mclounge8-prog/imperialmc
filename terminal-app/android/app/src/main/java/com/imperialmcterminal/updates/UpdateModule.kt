package com.imperialmcterminal.updates

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.imperialmcterminal.BuildConfig
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/**
 * Самостоятельные обновления терминала:
 * - полная установка APK (когда меняется native / АТОЛ / permissions)
 * - JS OTA: скачать zip с index.android.bundle, сохранить путь, перезапустить процесс
 *
 * Путь к OTA-бандлу читает MainApplication при старте через SharedPreferences.
 */
class UpdateModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "UpdateModule"

  // Нужны для NativeEventEmitter (иначе RN предупреждает).
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  @ReactMethod
  fun getAppVersion(promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences(PREFS, MODE)
      val map = Arguments.createMap()
      map.putInt("versionCode", BuildConfig.VERSION_CODE)
      map.putString("versionName", BuildConfig.VERSION_NAME)
      map.putInt("jsOtaVersion", prefs.getInt(KEY_JS_VERSION, 0))
      map.putBoolean("hasJsOta", prefs.getString(KEY_JS_BUNDLE, null) != null)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("VERSION_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(true)
        return
      }
      promise.resolve(reactApplicationContext.packageManager.canRequestPackageInstalls())
    } catch (e: Exception) {
      promise.reject("INSTALL_PERM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun openUnknownSourcesSettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${reactApplicationContext.packageName}")
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("SETTINGS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun downloadFile(url: String, fileName: String, promise: Promise) {
    thread {
      var connection: HttpURLConnection? = null
      try {
        val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val dir = File(reactApplicationContext.cacheDir, "updates").apply { mkdirs() }
        val outFile = File(dir, safeName)
        if (outFile.exists()) outFile.delete()

        connection = (URL(url).openConnection() as HttpURLConnection).apply {
          connectTimeout = 30_000
          readTimeout = 120_000
          instanceFollowRedirects = true
          requestMethod = "GET"
        }
        val code = connection.responseCode
        if (code !in 200..299) {
          promise.reject("DOWNLOAD_HTTP_$code", "Не удалось скачать файл (HTTP $code)")
          return@thread
        }

        val total = connection.contentLengthLong
        var downloaded = 0L
        BufferedInputStream(connection.inputStream).use { input ->
          FileOutputStream(outFile).use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
              downloaded += read
              if (total > 0) {
                emitProgress(safeName, downloaded.toDouble() / total.toDouble())
              }
            }
            output.flush()
          }
        }
        emitProgress(safeName, 1.0)
        promise.resolve(outFile.absolutePath)
      } catch (e: Exception) {
        promise.reject("DOWNLOAD_ERROR", e.message, e)
      } finally {
        connection?.disconnect()
      }
    }
  }

  @ReactMethod
  fun installApk(apkPath: String, promise: Promise) {
    try {
      val file = File(apkPath)
      if (!file.exists()) {
        promise.reject("APK_MISSING", "Файл APK не найден: $apkPath")
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !reactApplicationContext.packageManager.canRequestPackageInstalls()
      ) {
        promise.reject(
          "NEED_INSTALL_PERMISSION",
          "Разрешите установку из этого источника в настройках Android"
        )
        return
      }

      val uri = FileProvider.getUriForFile(
        reactApplicationContext,
        "${reactApplicationContext.packageName}.fileprovider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      val resInfo = reactApplicationContext.packageManager.queryIntentActivities(
        intent,
        PackageManager.MATCH_DEFAULT_ONLY
      )
      for (info in resInfo) {
        reactApplicationContext.grantUriPermission(
          info.activityInfo.packageName,
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      }

      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("INSTALL_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun applyJsBundleZip(zipPath: String, jsVersion: Int, promise: Promise) {
    thread {
      try {
        val zipFile = File(zipPath)
        if (!zipFile.exists()) {
          promise.reject("ZIP_MISSING", "ZIP не найден")
          return@thread
        }

        val otaRoot = File(reactApplicationContext.filesDir, "updates/ota").apply { mkdirs() }
        val targetDir = File(otaRoot, "v$jsVersion").apply {
          if (exists()) deleteRecursively()
          mkdirs()
        }

        unzip(zipFile, targetDir)

        val bundle = findBundle(targetDir)
          ?: run {
            promise.reject("BUNDLE_MISSING", "В ZIP нет index.android.bundle")
            return@thread
          }

        reactApplicationContext
          .getSharedPreferences(PREFS, MODE)
          .edit()
          .putString(KEY_JS_BUNDLE, bundle.absolutePath)
          .putInt(KEY_JS_VERSION, jsVersion)
          .putInt(KEY_JS_FOR_APK, BuildConfig.VERSION_CODE)
          .apply()

        promise.resolve(bundle.absolutePath)
      } catch (e: Exception) {
        promise.reject("JS_OTA_ERROR", e.message, e)
      }
    }
  }

  @ReactMethod
  fun clearJsOta(promise: Promise) {
    try {
      clearOtaPrefs(reactApplicationContext)
      File(reactApplicationContext.filesDir, "updates/ota").deleteRecursively()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CLEAR_OTA_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun restartApp(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      if (intent == null) {
        promise.reject("RESTART_ERROR", "Не найден launch intent")
        return
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      ctx.startActivity(intent)
      ctx.currentActivity?.finishAffinity()
      Runtime.getRuntime().exit(0)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RESTART_ERROR", e.message, e)
    }
  }

  private fun emitProgress(id: String, progress: Double) {
    val params = Arguments.createMap()
    params.putString("id", id)
    params.putDouble("progress", progress)
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_PROGRESS, params)
  }

  companion object {
    const val PREFS = "imperial_updates"
    const val KEY_JS_BUNDLE = "js_bundle_path"
    const val KEY_JS_VERSION = "js_ota_version"
    const val KEY_JS_FOR_APK = "js_for_apk_version"
    const val EVENT_PROGRESS = "UpdateDownloadProgress"
    private const val MODE = 0 // Context.MODE_PRIVATE

    fun resolveJsBundlePath(context: android.content.Context): String? {
      val prefs = context.getSharedPreferences(PREFS, MODE)
      val forApk = prefs.getInt(KEY_JS_FOR_APK, -1)
      if (forApk != BuildConfig.VERSION_CODE) {
        clearOtaPrefs(context)
        return null
      }
      val path = prefs.getString(KEY_JS_BUNDLE, null) ?: return null
      val file = File(path)
      return if (file.exists()) file.absolutePath else null
    }

    fun clearOtaPrefs(context: android.content.Context) {
      context.getSharedPreferences(PREFS, MODE)
        .edit()
        .remove(KEY_JS_BUNDLE)
        .remove(KEY_JS_VERSION)
        .remove(KEY_JS_FOR_APK)
        .apply()
    }

    private fun findBundle(root: File): File? {
      val direct = File(root, "index.android.bundle")
      if (direct.exists()) return direct
      return root.walkTopDown().firstOrNull { it.isFile && it.name == "index.android.bundle" }
    }

    private fun unzip(zipFile: File, targetDir: File) {
      ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
        var entry = zis.nextEntry
        while (entry != null) {
          val outFile = File(targetDir, entry.name)
          val normalized = outFile.canonicalPath
          if (!normalized.startsWith(targetDir.canonicalPath)) {
            throw IllegalStateException("Некорректный путь в ZIP: ${entry.name}")
          }
          if (entry.isDirectory) {
            outFile.mkdirs()
          } else {
            outFile.parentFile?.mkdirs()
            FileOutputStream(outFile).use { output ->
              zis.copyTo(output)
            }
          }
          zis.closeEntry()
          entry = zis.nextEntry
        }
      }
    }
  }
}
