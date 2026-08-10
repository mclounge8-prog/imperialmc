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
 *
 * Важно про IPC-обёртку libfptr10.aar: методы вроде processJson()/open()
 * почти всегда возвращают 0 даже при ошибке кассы. Реальный статус — в
 * errorCode()/errorDescription(). JSON-ответ задания — в
 * getParamString(LIBFPTR_PARAM_JSON_DATA); если его нет при errorCode==0,
 * пробуем достать ФД/ФПД через fnQueryData(LAST_DOCUMENT).
 */
class AtolModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AtolModule"

  /**
   * settingsJson: {"ipAddress": "192.168.1.50", "ipPort": 5555, "model": 57}
   * taskJson: JSON-задание для кассы, например {"type": "sell", ...}
   *
   * Резолвит promise с JSON-строкой ответа кассы при успехе, либо реджектит
   * с кодом/описанием ошибки драйвера.
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
      if (fptr.errorCode() != 0) {
        promise.reject(
          "ATOL_${fptr.errorCode()}",
          fptr.errorDescription() ?: "Не удалось применить настройки кассы"
        )
        return
      }

      // В IPC-варианте open()/close() — no-op (соединением управляет
      // приложение «Драйвер ККТ АТОЛ»), но оставляем вызов по API десктопа.
      fptr.open()
      if (fptr.errorCode() != 0) {
        promise.reject(
          "ATOL_${fptr.errorCode()}",
          fptr.errorDescription() ?: "Не удалось подключиться к кассе"
        )
        return
      }

      fptr.setParam(IFptr.LIBFPTR_PARAM_JSON_DATA, taskJson)
      fptr.processJson()
      if (fptr.errorCode() != 0) {
        promise.reject(
          "ATOL_${fptr.errorCode()}",
          fptr.errorDescription() ?: "Касса вернула ошибку"
        )
        return
      }

      var responseJson = fptr.getParamString(IFptr.LIBFPTR_PARAM_JSON_DATA)
      if (responseJson.isNullOrBlank()) {
        // Касса могла пробить чек, но не положить JSON в JSON_DATA
        // (встречается на IPC-обёртке). Достаём ФД/ФПД из последнего документа ФН.
        responseJson = queryLastDocumentAsJson(fptr)
        if (responseJson == null) {
          promise.reject(
            "ATOL_EMPTY_RESPONSE",
            "Касса вернула пустой ответ processJson (errorCode=0), " +
              "и не удалось прочитать последний документ ФН: " +
              (fptr.errorDescription() ?: "нет описания")
          )
          return
        }
      }

      promise.resolve(responseJson)
    } catch (e: Exception) {
      promise.reject("ATOL_EXCEPTION", e.message ?: "Неизвестная ошибка драйвера АТОЛ", e)
    } finally {
      try {
        fptr?.close()
        fptr?.destroy()
      } catch (_: Exception) {
        // Касса могла быть уже физически отключена — не мешаем завершению
      }
    }
  }

  /**
   * Собирает JSON вида {"fiscalParams":{...},"_source":"fnQueryData_lastDocument"}
   * из классического запроса последнего документа ФН. null — если не удалось.
   */
  private fun queryLastDocumentAsJson(fptr: Fptr): String? {
    fptr.setParam(IFptr.LIBFPTR_PARAM_FN_DATA_TYPE, IFptr.LIBFPTR_FNDT_LAST_DOCUMENT)
    fptr.fnQueryData()
    if (fptr.errorCode() != 0) {
      return null
    }
    val docNumber = fptr.getParamInt(IFptr.LIBFPTR_PARAM_DOCUMENT_NUMBER)
    val fiscalSign = fptr.getParamString(IFptr.LIBFPTR_PARAM_FISCAL_SIGN) ?: ""
    if (docNumber <= 0L && fiscalSign.isEmpty()) {
      return null
    }
    val fiscalParams = JSONObject()
    fiscalParams.put("fiscalDocumentNumber", docNumber)
    fiscalParams.put("fiscalDocumentSign", fiscalSign)
    val wrapper = JSONObject()
    wrapper.put("fiscalParams", fiscalParams)
    wrapper.put("_source", "fnQueryData_lastDocument")
    return wrapper.toString()
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
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }
}
