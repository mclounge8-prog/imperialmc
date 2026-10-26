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
import java.io.FileOutputStream
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
                if (code !in 200..299) error("code $code")
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
                "The update server did not respond. Open the file in the browser.",
                BuildConfig.APK_URL,
            )
        }
    }

    suspend fun download(release: RemoteRelease): File = withContext(Dispatchers.IO) {
        val part = File(context.cacheDir, "saldo-update.part")
        val target = File(context.cacheDir, "saldo-update.apk")
        if (target.exists()) target.delete()
        var last = "Could not download the build"
        repeat(8) {
            val offset = if (part.exists()) part.length() else 0L
            val connection = open(release.apkUrl)
            connection.setRequestProperty("Accept-Encoding", "identity")
            if (offset > 0L) connection.setRequestProperty("Range", "bytes=$offset-")
            try {
                when (val code = connection.responseCode) {
                    HttpURLConnection.HTTP_NOT_MODIFIED -> {
                        last = "The server returned an empty cached response"
                    }
                    in 200..299 -> {
                        val partial = code == HttpURLConnection.HTTP_PARTIAL
                        val range = connection.getHeaderField("Content-Range")
                        val total = if (partial) totalFrom(range) else connection.contentLengthLong
                        val start = if (partial) startFrom(range) else 0L
                        if (!partial || (start != null && start != part.length())) {
                            if (part.exists()) part.delete()
                        }
                        val append = partial && part.exists() && start == part.length()
                        connection.inputStream.use { input ->
                            FileOutputStream(part, append).use { output -> input.copyTo(output) }
                        }
                        if (total > 0L && part.length() < total) {
                            last = "The connection dropped during download"
                        } else {
                            validateApk(part, total)
                            if (target.exists()) target.delete()
                            if (!part.renameTo(target)) {
                                part.copyTo(target, overwrite = true)
                                part.delete()
                            }
                            return@withContext target
                        }
                    }
                    else -> last = "The server responded with code $code"
                }
            } catch (error: IllegalStateException) {
                last = error.message ?: last
                if (part.exists()) part.delete()
            } catch (_: Exception) {
                last = "The connection dropped during download"
            } finally {
                connection.disconnect()
            }
        }
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
            setRequestProperty("Accept", "*/*")
            setRequestProperty("Accept-Encoding", "identity")
            setRequestProperty("User-Agent", "FinSolution/${BuildConfig.VERSION_NAME} Android")
        }
    }

    private fun totalFrom(header: String?): Long =
        header?.substringAfter('/', "")?.substringBefore(' ')?.toLongOrNull() ?: -1L

    private fun startFrom(header: String?): Long? {
        val bytes = header?.substringAfter("bytes ", "")?.substringBefore('-') ?: return null
        return bytes.toLongOrNull()
    }

    private fun validateApk(file: File, expected: Long) {
        if (expected > 0 && file.length() != expected) {
            file.delete()
            throw IllegalStateException("The file did not download completely")
        }
        if (file.length() < 1_000_000L) {
            file.delete()
            throw IllegalStateException("The downloaded file is too small")
        }
        val magic = ByteArray(2)
        val read = file.inputStream().use { it.read(magic) }
        val zip = read == 2 && magic[0] == 0x50.toByte() && magic[1] == 0x4B.toByte()
        if (!zip) {
            file.delete()
            throw IllegalStateException("The downloaded file is not an installer")
        }
    }
}
