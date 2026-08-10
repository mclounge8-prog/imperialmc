package com.imperialmcterminal.atol

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import ru.atol.drivers10.fptr.Fptr
import ru.atol.drivers10.fptr.IFptr

/**
 * Мост JS <-> касса АТОЛ. Ничего не встраивает напрямую — только общается
 * (через libfptr10.aar, ipc-вариант) с отдельно установленным на этот же
 * планшет приложением "Драйвер ККТ АТОЛ" (ru.atol.drivers10.service) по
 * TCP/IP, ровно как QuickResto. Касса физически находится в локальной сети
 * точки, наше приложение просто указывает ей IP/порт/модель при каждом
 * подключении — никаких данных постоянно не хранит на устройстве.
 *
 * JSON-задания (openShift/closeShift/sell и т.д.) собираются на backend
 * (см. backoffice/src/services/fiscalQueue.js) — этот модуль их не строит,
 * только передаёт кассе через processJson() и возвращает её ответ как есть.
 */
class AtolModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AtolModule"

  /**
   * settingsJson: {"ipAddress": "192.168.1.50", "ipPort": 5555, "model": 57}
   * taskJson: JSON-задание для кассы, например {"type": "sell", ...}
   *
   * Резолвит promise с JSON-строкой ответа кассы при успехе, либо реджектит
   * с кодом/описанием ошибки драйвера (см. errorCode()/errorDescription()) —
   * коды ошибок совпадают с десктопным драйвером, расшифровку см. в
   * atol-agent (в этом проекте больше не используется, но справочник ошибок
   * там актуален) или в документации АТОЛ.
   */
  @ReactMethod
  fun runTask(settingsJson: String, taskJson: String, promise: Promise) {
    var fptr: Fptr? = null
    try {
      val settings = JSONObject(settingsJson)
      val ipAddress = settings.optString("ipAddress", "")
      val ipPort = settings.optInt("ipPort", 5555)
      val model = if (settings.has("model") && !settings.isNull("model")) settings.optInt("model") else null

      if (ipAddress.isEmpty()) {
        promise.reject("ATOL_NO_SETTINGS", "Не задан IP-адрес кассы АТОЛ")
        return
      }

      fptr = Fptr(reactApplicationContext, "ImperialMC")

      fptr.setSingleSetting(IFptr.LIBFPTR_SETTING_PORT, IFptr.LIBFPTR_PORT_TCPIP.toString())
      fptr.setSingleSetting(IFptr.LIBFPTR_SETTING_IPADDRESS, ipAddress)
      fptr.setSingleSetting(IFptr.LIBFPTR_SETTING_IPPORT, ipPort.toString())
      if (model != null) {
        fptr.setSingleSetting(IFptr.LIBFPTR_SETTING_MODEL, model.toString())
      }
      fptr.applySingleSettings()

      val openResult = fptr.open()
      if (openResult < 0) {
        promise.reject("ATOL_${fptr.errorCode()}", fptr.errorDescription() ?: "Не удалось подключиться к кассе")
        return
      }

      fptr.setParam(IFptr.LIBFPTR_PARAM_JSON_DATA, taskJson)
      val taskResult = fptr.processJson()
      if (taskResult < 0) {
        promise.reject("ATOL_${fptr.errorCode()}", fptr.errorDescription() ?: "Касса вернула ошибку")
        return
      }

      val responseJson = fptr.getParamString(IFptr.LIBFPTR_PARAM_JSON_DATA)
      promise.resolve(responseJson)
    } catch (e: Exception) {
      promise.reject("ATOL_EXCEPTION", e.message ?: "Неизвестная ошибка драйвера АТОЛ", e)
    } finally {
      try {
        fptr?.close()
        fptr?.destroy()
      } catch (e: Exception) {
        // Касса могла быть уже физически отключена — не мешаем завершению
      }
    }
  }

  /**
   * Быстрая проверка перед показом настроек "Касса АТОЛ" в приложении —
   * отвечает true/false, установлено ли на этом устройстве приложение
   * "Драйвер ККТ АТОЛ" (ru.atol.drivers10.service), без попытки подключения к кассе.
   */
  @ReactMethod
  fun isDriverAppInstalled(promise: Promise) {
    try {
      reactApplicationContext.packageManager.getPackageInfo("ru.atol.drivers10.service", 0)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }
}
