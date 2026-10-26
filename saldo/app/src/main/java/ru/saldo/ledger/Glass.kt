package ru.saldo.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AppCanvas(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxSize()
            .background(Paper)
            .drawBehind {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFFDCECE6), Color.Transparent),
                        center = Offset(size.width * 0.08f, 0f),
                        radius = size.width * 0.9f,
                    ),
                    radius = size.width * 0.9f,
                    center = Offset(size.width * 0.08f, 0f),
                )
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFFF6E7D4), Color.Transparent),
                        center = Offset(size.width * 0.95f, size.height * 0.28f),
                        radius = size.width * 0.55f,
                    ),
                    radius = size.width * 0.55f,
                    center = Offset(size.width * 0.95f, size.height * 0.28f),
                )
            },
    )
}

@Composable
fun Wordmark() {
    Text(
        "FIN SOLUTION",
        color = Muted,
        fontFamily = Jakarta,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 2.2.sp,
    )
}

@Composable
fun SheetGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .shadow(10.dp, RoundedCornerShape(26.dp), ambientColor = Color(0x141C1916), spotColor = Color(0x101C1916))
            .clip(RoundedCornerShape(26.dp))
            .background(Sheet),
        content = content,
    )
}

@Composable
fun GroupDivider(inset: Dp = 16.dp) {
    Box(
        Modifier
            .padding(start = inset)
            .fillMaxWidth()
            .height(1.dp)
            .background(Line),
    )
}

@Composable
fun MoneyText(
    value: String,
    size: TextUnit,
    modifier: Modifier = Modifier,
    weight: FontWeight = FontWeight.SemiBold,
    color: Color = Ink,
) {
    Text(
        value,
        modifier = modifier,
        style = TextStyle(
            color = color,
            fontFamily = Jakarta,
            fontWeight = weight,
            fontSize = size,
            letterSpacing = (-0.5).sp,
            fontFeatureSettings = "tnum",
        ),
    )
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val background = if (enabled) Pine else Stone
    val foreground = if (enabled) Color.White else StoneText
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = foreground,
            fontFamily = Jakarta,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun ChoiceChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
) {
    val background = if (selected) Pine else Sheet
    val foreground = if (selected) Color.White else Ink
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, if (selected) Pine else Line, RoundedCornerShape(999.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Box(Modifier.size(8.dp))
        }
        Text(
            label,
            color = foreground,
            fontFamily = Jakarta,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
        )
    }
}

@Composable
fun Dock(
    tabs: List<Triple<String, ImageVector, Boolean>>,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .shadow(16.dp, RoundedCornerShape(30.dp), ambientColor = Color(0x221C1916), spotColor = Color(0x181C1916))
            .clip(RoundedCornerShape(30.dp))
            .background(Sheet)
            .border(1.dp, Line, RoundedCornerShape(30.dp))
            .padding(5.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { index, (label, icon, selected) ->
            val foreground = if (selected) Color.White else StoneText
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(if (selected) Pine else Color.Transparent)
                    .clickable(role = Role.Tab, onClick = { onSelect(index) })
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, contentDescription = label, tint = foreground, modifier = Modifier.size(20.dp))
                Text(
                    label,
                    color = foreground,
                    fontFamily = Jakarta,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
