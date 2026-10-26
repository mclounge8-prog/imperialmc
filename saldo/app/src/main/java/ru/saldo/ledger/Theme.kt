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

val Paper = Color(0xFFF5F4F8)
val Sheet = Color(0xFFFFFFFF)
val Ink = Color(0xFF17161C)
val Muted = Color(0xFF8B8794)
val Line = Color(0xFFE8E6EE)
val Brand = Color(0xFF5C34FF)
val BrandDeep = Color(0xFF3D1FD4)
val BrandSoft = Color(0xFF8B6CFF)
val BrandWash = Color(0xFFF3F0FF)
val Field = Color(0xFFF6F5F8)

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
            primary = Brand,
            onPrimary = Color.White,
            primaryContainer = BrandWash,
            onPrimaryContainer = BrandDeep,
            secondary = Brand,
            onSecondary = Color.White,
            background = Paper,
            onBackground = Ink,
            surface = Sheet,
            onSurface = Ink,
            surfaceVariant = BrandWash,
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
