package ru.saldo.ledger

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val cardShape = RoundedCornerShape(28.dp)

@Composable
fun AppCanvas(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxSize()
            .background(Paper)
            .drawBehind {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFFE4DCFF), Color.Transparent),
                        center = Offset(size.width * 0.9f, -size.height * 0.02f),
                        radius = size.width * 0.75f,
                    ),
                    radius = size.width * 0.75f,
                    center = Offset(size.width * 0.9f, -size.height * 0.02f),
                )
            },
    )
}

@Composable
fun BrandLockup(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Image(
            painterResource(R.drawable.ic_logo),
            contentDescription = "FinSolution",
            modifier = Modifier.size(46.dp),
        )
        Spacer(Modifier.size(12.dp))
        Column {
            Text(
                "Finance",
                color = Ink,
                fontFamily = Jakarta,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                letterSpacing = (-0.4).sp,
            )
            Text(
                "Solutions",
                color = Brand,
                fontFamily = Jakarta,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                letterSpacing = 0.2.sp,
            )
        }
    }
}

@Composable
fun SheetGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .shadow(14.dp, cardShape, ambientColor = Color(0x145C34FF), spotColor = Color(0x0F1C1B22))
            .clip(cardShape)
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
            letterSpacing = (-0.6).sp,
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
    val background = if (enabled) Brand else BrandWash
    val foreground = if (enabled) Color.White else BrandDeep
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = foreground,
            fontFamily = Jakarta,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun LightButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color.White)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = BrandDeep,
            fontFamily = Jakarta,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
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
    val background = if (selected) Brand else Sheet
    val foreground = if (selected) Color.White else Ink
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, if (selected) Brand else Line, RoundedCornerShape(999.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.size(8.dp))
        }
        Text(label, color = foreground, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

@Composable
fun ActionOrb(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.clickable(role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(58.dp)
                .shadow(8.dp, CircleShape, ambientColor = Color(0x1A5C34FF), spotColor = Color(0x145C34FF))
                .clip(CircleShape)
                .background(Sheet),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = Brand, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            label,
            color = Ink,
            fontFamily = Jakarta,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
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
            .shadow(18.dp, RoundedCornerShape(32.dp), ambientColor = Color(0x1F5C34FF), spotColor = Color(0x1417161C))
            .clip(RoundedCornerShape(32.dp))
            .background(Sheet)
            .padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { index, (label, icon, selected) ->
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (selected) Brand else Color.Transparent)
                    .clickable(role = Role.Tab, onClick = { onSelect(index) })
                    .padding(vertical = 7.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    icon,
                    contentDescription = label,
                    tint = if (selected) Color.White else Color(0xFF5E5A68),
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    label,
                    color = if (selected) Color.White else Color(0xFF5E5A68),
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
