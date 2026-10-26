package ru.saldo.ledger

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Paper = Color(0xFFF3EEE6)
val Sheet = Color(0xFFFFFCF8)
val Ink = Color(0xFF1C1916)
val Muted = Color(0xFF7A7268)
val Line = Color(0xFFE6DDD1)
val Pine = Color(0xFF0F6E58)
val PineDeep = Color(0xFF0B5343)
val PineWash = Color(0xFFE5F3EE)
val Sand = Color(0xFFF7F1E8)
val Stone = Color(0xFFE3DBD0)
val StoneText = Color(0xFF5E574E)

val Jakarta = FontFamily(
    Font(R.font.jakarta_regular, FontWeight.Normal),
    Font(R.font.jakarta_medium, FontWeight.Medium),
    Font(R.font.jakarta_semibold, FontWeight.SemiBold),
    Font(R.font.jakarta_bold, FontWeight.Bold),
    Font(R.font.jakarta_extrabold, FontWeight.ExtraBold),
)

@Composable
fun SaldoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Pine,
            onPrimary = Color.White,
            primaryContainer = PineWash,
            onPrimaryContainer = PineDeep,
            secondary = Pine,
            onSecondary = Color.White,
            background = Paper,
            onBackground = Ink,
            surface = Sheet,
            onSurface = Ink,
            surfaceVariant = Sand,
            onSurfaceVariant = Muted,
            outline = Line,
            error = Color(0xFF9A4032),
            onError = Color.White,
        ),
        typography = MaterialTheme.typography.copy(
            bodyLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 16.sp, color = Ink),
            bodyMedium = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = Ink),
            labelLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Color.White),
            titleLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, color = Ink, letterSpacing = (-0.6).sp),
        ),
        content = content,
    )
}
