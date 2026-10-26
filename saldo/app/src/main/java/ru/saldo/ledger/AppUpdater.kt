package ru.saldo.ledger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

@Serializable
data class RemoteRelease(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val notes: String = "",
)

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data class Available(val release: RemoteRelease) : UpdateState
    data class Downloading(val release: RemoteRelease) : UpdateState
    data class Ready(val release: RemoteRelease, val file: File) : UpdateState
    data class Failed(val message: String, val apkUrl: String? = null) : UpdateState
    data object Current : UpdateState
}

class AppUpdater(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun check(): UpdateState = withContext(Dispatchers.IO) {
        runCatching {
            val connection = open(BuildConfig.UPDATE_URL)
            try {
                val code = connection.responseCode
                if (code !in 200..299) error("код $code")
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val release = json.decodeFromString<RemoteRelease>(body)
                if (release.versionCode > BuildConfig.VERSION_CODE) {
                    UpdateState.Available(release)
                } else {
                    UpdateState.Current
                }
            } finally {
                connection.disconnect()
            }
        }.getOrElse {
            UpdateState.Failed(
                "Сервер обновлений не ответил. Файл можно открыть в браузере.",
                BuildConfig.APK_URL,
            )
        }
    }

    suspend fun download(release: RemoteRelease): File = withContext(Dispatchers.IO) {
        val target = File(context.cacheDir, "saldo-update.apk")
        val urls = listOf(release.apkUrl, cacheBust(release.apkUrl))
        var last = "Не удалось скачать сборку"
        for (url in urls) {
            if (target.exists()) target.delete()
            val connection = open(url)
            try {
                val code = connection.responseCode
                if (code == HttpURLConnection.HTTP_NOT_MODIFIED) {
                    last = "Сервер отдал пустой кэш вместо файла"
                    continue
                }
                if (code !in 200..299) {
                    last = "Сервер ответил кодом $code"
                    continue
                }
                val expected = connection.contentLengthLong
                connection.inputStream.use { input ->
                    target.outputStream().use { output -> input.copyTo(output) }
                }
                validateApk(target, expected)
                return@withContext target
            } catch (error: IllegalStateException) {
                last = error.message ?: last
            } catch (_: Exception) {
                last = "Связь оборвалась во время загрузки"
            } finally {
                connection.disconnect()
            }
        }
        if (target.exists()) target.delete()
        throw IllegalStateException(last)
    }

    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun openInBrowser(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun install(file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun open(url: String): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 180_000
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache, no-store")
            setRequestProperty("Pragma", "no-cache")
            setRequestProperty("Accept", "*/*")
            setRequestProperty("User-Agent", "FinSolution/${BuildConfig.VERSION_NAME} Android")
        }
    }

    private fun cacheBust(url: String): String {
        val join = if (url.contains("?")) "&" else "?"
        return "$url${join}fresh=${System.currentTimeMillis()}"
    }

    private fun validateApk(file: File, expected: Long) {
        if (expected > 0 && file.length() != expected) {
            file.delete()
            throw IllegalStateException("Файл скачался не целиком")
        }
        if (file.length() < 1_000_000L) {
            file.delete()
            throw IllegalStateException("Скачанный файл слишком маленький")
        }
        val magic = ByteArray(2)
        val read = file.inputStream().use { it.read(magic) }
        val zip = read == 2 && magic[0] == 0x50.toByte() && magic[1] == 0x4B.toByte()
        if (!zip) {
            file.delete()
            throw IllegalStateException("Скачанный файл не является установщиком")
        }
    }
}
