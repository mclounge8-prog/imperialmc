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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.emptyBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.isRenderEffectSupported
import com.kyant.backdrop.isRuntimeShaderSupported
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow

val LocalBackdrop = staticCompositionLocalOf<Backdrop> { emptyBackdrop() }

@Composable
fun Modifier.glass(
    radius: Dp = 28.dp,
    tint: Color = Color.White.copy(alpha = 0.46f),
    lens: Boolean = true,
    backdrop: Backdrop = LocalBackdrop.current,
): Modifier {
    val shape = RoundedCornerShape(radius)
    if (!isRenderEffectSupported()) {
        return clip(shape)
            .background(Color.White.copy(alpha = 0.86f))
            .border(1.dp, Color.White.copy(alpha = 0.9f), shape)
    }
    val density = LocalDensity.current
    val blurPx = with(density) { 20.dp.toPx() }
    val refraction = with(density) { 14.dp.toPx() }
    val amount = with(density) { 28.dp.toPx() }
    return drawBackdrop(
        backdrop = backdrop,
        shape = { shape },
        effects = {
            vibrancy()
            blur(blurPx)
            if (lens && isRuntimeShaderSupported()) {
                lens(refraction, amount, depthEffect = true, chromaticAberration = true)
            }
        },
        highlight = { Highlight.Default },
        shadow = { Shadow(radius = 22.dp, color = Color(0xFF3D1FD4).copy(alpha = 0.16f)) },
        innerShadow = { InnerShadow(radius = 10.dp, alpha = 0.28f) },
        onDrawSurface = { drawRect(tint) },
    )
}

@Composable
fun AuroraBackground(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxSize()
            .background(Color(0xFFE7E2F6))
            .drawBehind {
                fun orb(center: Offset, radius: Float, color: Color) {
                    drawCircle(
                        brush = Brush.radialGradient(
                            colors = listOf(color, Color.Transparent),
                            center = center,
                            radius = radius,
                        ),
                        radius = radius,
                        center = center,
                    )
                }
                orb(Offset(size.width * 0.02f, size.height * 0.02f), size.width * 0.92f, Color(0xFF7C5CFF).copy(alpha = 0.62f))
                orb(Offset(size.width * 1.02f, size.height * 0.16f), size.width * 0.68f, Color(0xFF4C9DFF).copy(alpha = 0.48f))
                orb(Offset(size.width * 0.12f, size.height * 0.78f), size.width * 0.74f, Color(0xFFFF7EC8).copy(alpha = 0.30f))
                orb(Offset(size.width * 0.88f, size.height * 0.96f), size.width * 0.58f, Color(0xFF5C34FF).copy(alpha = 0.36f))
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
                .background(Brush.linearGradient(listOf(Color(0x663D1FD4), Color(0x662A13A0)))),
        )
        Box(
            Modifier
                .size(40.dp, 16.dp)
                .offset(y = 2.dp)
                .clip(RoundedCornerShape(50))
                .background(Brush.linearGradient(listOf(Color(0xB35C34FF), Color(0xB33D1FD4)))),
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
    Column(Modifier.fillMaxWidth().glass(32.dp, Color.White.copy(alpha = 0.38f)).padding(22.dp)) {
        Text(
            "BALANCE",
            color = Muted,
            fontFamily = Jakarta,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            letterSpacing = 1.6.sp,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            balance,
            color = Ink,
            fontFamily = Jakarta,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 40.sp,
            letterSpacing = (-1).sp,
        )
        Text(
            "Everything recorded on this phone",
            color = Muted,
            fontFamily = Jakarta,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Income", color = Muted, fontFamily = Jakarta, fontSize = 12.sp)
                Text(income, color = Income, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
            Column(Modifier.weight(1f)) {
                Text("Expenses", color = Muted, fontFamily = Jakarta, fontSize = 12.sp)
                Text(expense, color = Expense, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
fun GlassNav(
    tabs: List<Triple<String, ImageVector, Boolean>>,
    backdrop: Backdrop,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(50)
    val density = LocalDensity.current
    val blurPx = with(density) { 22.dp.toPx() }
    val refraction = with(density) { 16.dp.toPx() }
    val material = if (isRenderEffectSupported()) {
        Modifier.drawBackdrop(
                backdrop = backdrop,
                shape = { shape },
                effects = {
                    vibrancy()
                    blur(blurPx)
                    if (isRuntimeShaderSupported()) {
                        lens(refraction, refraction, depthEffect = true, chromaticAberration = true)
                    }
                },
                highlight = { Highlight.Default },
                shadow = { Shadow(radius = 28.dp, color = Color.Black.copy(alpha = 0.14f)) },
                innerShadow = { InnerShadow(radius = 12.dp, alpha = 0.35f) },
                onDrawSurface = { drawRect(Color.White.copy(alpha = 0.28f)) },
            )
    } else {
        Modifier
            .clip(shape)
            .background(Color.White.copy(alpha = 0.9f))
            .border(1.dp, Color.White.copy(alpha = 0.95f), shape)
    }
    Row(
        modifier
            .then(material)
            .padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { index, (label, icon, selected) ->
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (selected) Color.White.copy(alpha = 0.72f) else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    icon,
                    contentDescription = label,
                    tint = if (selected) CopperDeep else Ink.copy(alpha = 0.55f),
                    modifier = Modifier.size(21.dp),
                )
                Text(
                    label,
                    color = if (selected) CopperDeep else Ink.copy(alpha = 0.62f),
                    fontFamily = Jakarta,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 10.sp,
                    maxLines = 1,
                )
            }
        }
    }
}
