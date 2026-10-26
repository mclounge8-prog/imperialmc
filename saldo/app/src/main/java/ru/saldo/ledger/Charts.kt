package ru.saldo.ledger

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min

@Composable
fun ExpenseDonut(
    values: List<Float>,
    colors: List<Color>,
    centerValue: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(210.dp)
            .clipToBounds(),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize().clipToBounds()) {
            val total = values.sum().takeIf { it > 0f } ?: return@Canvas
            val stroke = 26.dp.toPx()
            val pad = stroke / 2f + 6.dp.toPx()
            val side = min(size.width, size.height) - pad * 2f
            val topLeft = Offset((size.width - side) / 2f, (size.height - side) / 2f)
            val arc = Size(side, side)
            drawArc(
                color = Line,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arc,
                style = Stroke(width = stroke, cap = StrokeCap.Butt),
            )
            var start = -90f
            val gap = if (values.count { it > 0f } > 1) 2.2f else 0f
            values.forEachIndexed { index, value ->
                val sweep = value / total * 360f
                if (sweep > 0f) {
                    drawArc(
                        color = colors.getOrElse(index) { Pine },
                        startAngle = start + gap / 2f,
                        sweepAngle = (sweep - gap).coerceAtLeast(0.4f),
                        useCenter = false,
                        topLeft = topLeft,
                        size = arc,
                        style = Stroke(width = stroke, cap = StrokeCap.Butt),
                    )
                }
                start += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Spent", color = Muted, fontFamily = Jakarta, fontSize = 12.sp)
            MoneyText(centerValue, 22.sp, weight = FontWeight.Bold)
        }
    }
}

@Composable
fun MonthColumns(values: List<Double>, labels: List<String>, modifier: Modifier = Modifier) {
    val max = values.maxOrNull()?.takeIf { it > 0.0 } ?: 1.0
    Column(modifier.fillMaxWidth().clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(140.dp)
                .clipToBounds(),
        ) {
            val count = values.size.coerceAtLeast(1)
            val slot = size.width / count
            val barWidth = slot * 0.56f
            values.forEachIndexed { index, value ->
                if (value <= 0.0) return@forEachIndexed
                val barHeight = ((value / max) * (size.height - 6.dp.toPx())).toFloat().coerceAtLeast(8.dp.toPx())
                val left = slot * index + (slot - barWidth) / 2f
                drawRoundRect(
                    color = Pine,
                    topLeft = Offset(left, size.height - barHeight),
                    size = Size(barWidth, barHeight),
                    cornerRadius = CornerRadius(10.dp.toPx(), 10.dp.toPx()),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
            labels.forEach { label ->
                Text(
                    label,
                    modifier = Modifier.weight(1f),
                    color = Muted,
                    fontFamily = Jakarta,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                )
            }
        }
    }
}
