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

val Paper = Color(0xFFF4F3F7)
val Cream = Color(0xF7F6FA)
val Ink = Color(0xFF1C1B22)
val Muted = Color(0xFF8A8696)
val Line = Color(0xFFE4E0EE)
val Copper = Color(0xFF5C34FF)
val CopperDeep = Color(0xFF3D1FD4)
val CopperSoft = Color(0xFFF3F0FA)
val Night = Color(0xFF171717)
val NightText = Color(0xFFFFFFFF)
val Income = Color(0xFF149A4A)
val Expense = Color(0xFFFF5A5A)
val PurpleSoft = Color(0xFF8B6CFF)
val Lilac = Color(0xFFEBE6FF)

val Jakarta = FontFamily(
    Font(R.font.jakarta_regular, FontWeight.Normal),
    Font(R.font.jakarta_medium, FontWeight.Medium),
    Font(R.font.jakarta_semibold, FontWeight.SemiBold),
    Font(R.font.jakarta_bold, FontWeight.Bold),
    Font(R.font.jakarta_extrabold, FontWeight.ExtraBold),
)

val Fraunces = Jakarta
val Manrope = Jakarta

@Composable
fun SaldoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Copper,
            onPrimary = Color.White,
            primaryContainer = CopperSoft,
            onPrimaryContainer = CopperDeep,
            secondary = Ink,
            onSecondary = Color.White,
            background = Paper,
            onBackground = Ink,
            surface = Color.White,
            onSurface = Ink,
            surfaceVariant = CopperSoft,
            onSurfaceVariant = Muted,
            outline = Line,
            error = Expense,
            onError = Color.White,
        ),
        typography = MaterialTheme.typography.copy(
            bodyLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 16.sp, color = Ink),
            bodyMedium = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = Ink),
            labelLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 14.sp),
            titleLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, color = Ink, letterSpacing = (-0.4).sp),
        ),
        content = content,
    )
}
