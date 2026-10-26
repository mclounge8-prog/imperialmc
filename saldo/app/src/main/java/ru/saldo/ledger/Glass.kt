package ru.saldo.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text

private val PurpleGlow = Color(0xFF5C34FF)
private val LilacGlow = Color(0xFF9C7AFF)

fun Modifier.glass(radius: Dp = 24.dp, tint: Color = Color.White.copy(alpha = 0.62f)): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .shadow(16.dp, shape, ambientColor = Color(0x2E5C34FF), spotColor = Color(0x245C34FF))
        .clip(shape)
        .background(tint)
        .border(1.dp, Color.White.copy(alpha = 0.88f), shape)
        .drawBehind {
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color.White.copy(alpha = 0.55f), Color.Transparent),
                    startY = 0f,
                    endY = size.height * 0.42f,
                ),
            )
            drawLine(
                color = Color.White.copy(alpha = 0.95f),
                start = Offset(radius.toPx(), 1.2f),
                end = Offset(size.width - radius.toPx(), 1.2f),
                strokeWidth = 1.6f,
            )
        }
}

@Composable
fun AuroraBackground(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFFEBE6FF), Paper),
                ),
            )
            .drawBehind {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(PurpleGlow.copy(alpha = 0.22f), Color.Transparent),
                        center = Offset(size.width * 0.12f, size.height * 0.02f),
                        radius = size.width * 0.72f,
                    ),
                    radius = size.width * 0.72f,
                    center = Offset(size.width * 0.12f, size.height * 0.02f),
                )
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(LilacGlow.copy(alpha = 0.28f), Color.Transparent),
                        center = Offset(size.width * 0.92f, size.height * 0.16f),
                        radius = size.width * 0.55f,
                    ),
                    radius = size.width * 0.55f,
                    center = Offset(size.width * 0.92f, size.height * 0.16f),
                )
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFF0A7AFF).copy(alpha = 0.10f), Color.Transparent),
                        center = Offset(size.width * 0.7f, size.height * 0.82f),
                        radius = size.width * 0.48f,
                    ),
                    radius = size.width * 0.48f,
                    center = Offset(size.width * 0.7f, size.height * 0.82f),
                )
            },
    )
}

@Composable
fun BrandLockup() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CoinMark()
        Spacer(Modifier.width(12.dp))
        Column {
            Text(
                "FINANCE",
                color = Ink,
                fontFamily = Jakarta,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                letterSpacing = (-0.4).sp,
            )
            Text(
                "SOLUTIONS",
                color = Color(0xFF6645CC),
                fontFamily = Jakarta,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
                letterSpacing = 3.2.sp,
            )
        }
    }
}

@Composable
fun CoinMark(modifier: Modifier = Modifier) {
    Box(modifier.size(44.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(40.dp, 14.dp)
                .offset(y = 10.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    Brush.linearGradient(listOf(Color(0x663D1FD4), Color(0x662A13A0))),
                ),
        )
        Box(
            Modifier
                .size(40.dp, 16.dp)
                .offset(y = 2.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    Brush.linearGradient(listOf(Color(0xB35C34FF), Color(0xB33D1FD4))),
                ),
        )
        Box(
            Modifier
                .size(40.dp, 16.dp)
                .offset(y = (-8).dp)
                .clip(RoundedCornerShape(50))
                .background(Brush.linearGradient(listOf(Color(0xFF9C7AFF), Copper))),
        )
    }
}

@Composable
fun BalanceSlab(balance: String, income: String, expense: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .shadow(22.dp, RoundedCornerShape(28.dp), ambientColor = Color(0x665C34FF), spotColor = Color(0x595C34FF))
            .clip(RoundedCornerShape(28.dp))
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF6A45FF), Color(0xFF5C34FF), Color(0xFF3F22D2)),
                ),
            )
            .drawBehind {
                drawCircle(
                    brush = Brush.radialGradient(
                        listOf(Color.White.copy(alpha = 0.22f), Color.Transparent),
                        center = Offset(size.width * 0.88f, size.height * 0.12f),
                        radius = size.width * 0.55f,
                    ),
                    radius = size.width * 0.55f,
                    center = Offset(size.width * 0.88f, size.height * 0.12f),
                )
                drawLine(
                    color = Color.White.copy(alpha = 0.45f),
                    start = Offset(28.dp.toPx(), 1.5f),
                    end = Offset(size.width - 28.dp.toPx(), 1.5f),
                    strokeWidth = 2f,
                )
            },
    ) {
        Column(Modifier.padding(22.dp)) {
            Text(
                "FINANCE",
                color = Color.White.copy(alpha = 0.78f),
                fontFamily = Jakarta,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                letterSpacing = 1.6.sp,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                balance,
                color = Color.White,
                fontFamily = Jakarta,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 40.sp,
                letterSpacing = (-1).sp,
            )
            Text(
                "Остаток по всем операциям",
                color = Color.White.copy(alpha = 0.82f),
                fontFamily = Jakarta,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FrostChip("Доходы", income, Modifier.weight(1f))
                FrostChip("Расходы", expense, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FrostChip(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .glass(16.dp, Color.White.copy(alpha = 0.16f))
            .padding(12.dp),
    ) {
        Text(label, color = Color.White.copy(alpha = 0.78f), fontFamily = Jakarta, fontSize = 12.sp)
        Text(value, color = Color.White, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
fun GlassNav(
    tabs: List<Triple<String, ImageVector, Boolean>>,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .glass(32.dp, Color.White.copy(alpha = 0.72f))
            .padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { index, (label, icon, selected) ->
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (selected) CopperSoft else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, contentDescription = label, tint = if (selected) CopperDeep else Muted, modifier = Modifier.size(20.dp))
                Text(
                    label,
                    color = if (selected) CopperDeep else Muted,
                    fontFamily = Jakarta,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 10.sp,
                    maxLines = 1,
                )
            }
        }
    }
}
