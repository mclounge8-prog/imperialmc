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
    data class Failed(val message: String) : UpdateState
    data object Current : UpdateState
}

class AppUpdater(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun check(): UpdateState = withContext(Dispatchers.IO) {
        runCatching {
            val connection = (URL(BuildConfig.UPDATE_URL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                instanceFollowRedirects = true
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()
            val release = json.decodeFromString<RemoteRelease>(body)
            if (release.versionCode > BuildConfig.VERSION_CODE) {
                UpdateState.Available(release)
            } else {
                UpdateState.Current
            }
        }.getOrElse { UpdateState.Failed("Сервер обновлений не ответил") }
    }

    suspend fun download(release: RemoteRelease): File = withContext(Dispatchers.IO) {
        val target = File(context.cacheDir, "saldo-update.apk")
        val connection = (URL(release.apkUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 60000
            instanceFollowRedirects = true
        }
        connection.inputStream.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
        connection.disconnect()
        target
    }

    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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
}
