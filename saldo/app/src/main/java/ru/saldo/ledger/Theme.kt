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

val Paper = Color(0xFFF4F0E8)
val Cream = Color(0xFFFFFCF7)
val Ink = Color(0xFF1A1814)
val Muted = Color(0xFF6F6A62)
val Line = Color(0xFFE4DDD2)
val Copper = Color(0xFFB85C38)
val CopperDeep = Color(0xFF8C3E22)
val CopperSoft = Color(0xFFF3E2D6)
val Night = Color(0xFF231C16)
val NightText = Color(0xFFF6F0E6)
val Income = Color(0xFF1E7A4D)
val IncomeSoft = Color(0xFFE5F4EC)
val Expense = Color(0xFFA33B32)
val ExpenseSoft = Color(0xFFF8E8E6)

val Fraunces = FontFamily(
    Font(R.font.fraunces_regular, FontWeight.Normal),
    Font(R.font.fraunces_semibold, FontWeight.SemiBold),
)

val Manrope = FontFamily(
    Font(R.font.manrope_regular, FontWeight.Normal),
    Font(R.font.manrope_medium, FontWeight.Medium),
    Font(R.font.manrope_semibold, FontWeight.SemiBold),
    Font(R.font.manrope_bold, FontWeight.Bold),
)

@Composable
fun SaldoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Copper,
            onPrimary = Cream,
            primaryContainer = CopperSoft,
            onPrimaryContainer = CopperDeep,
            secondary = Ink,
            onSecondary = Cream,
            background = Paper,
            onBackground = Ink,
            surface = Cream,
            onSurface = Ink,
            surfaceVariant = Color(0xFFEFEAE2),
            onSurfaceVariant = Muted,
            outline = Line,
            error = Expense,
            onError = Cream,
        ),
        typography = MaterialTheme.typography.copy(
            bodyLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 16.sp, color = Ink),
            bodyMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = Ink),
            labelLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
            titleLarge = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight.SemiBold, fontSize = 28.sp, color = Ink),
        ),
        content = content,
    )
}
