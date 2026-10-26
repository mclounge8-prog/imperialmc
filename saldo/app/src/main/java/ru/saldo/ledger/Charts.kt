package ru.saldo.ledger

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
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
            val stroke = 22.dp.toPx()
            val pad = stroke / 2f + 8.dp.toPx()
            val side = min(size.width, size.height) - pad * 2f
            val topLeft = Offset((size.width - side) / 2f, (size.height - side) / 2f)
            val arc = Size(side, side)
            drawArc(
                color = BrandWash,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arc,
                style = Stroke(width = stroke, cap = StrokeCap.Butt),
            )
            var start = -90f
            val gap = if (values.count { it > 0f } > 1) 2.4f else 0f
            values.forEachIndexed { index, value ->
                val sweep = value / total * 360f
                if (sweep > 0f) {
                    drawArc(
                        color = colors.getOrElse(index) { Brand },
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
fun SpendingCurve(
    values: List<Double>,
    labels: List<String>,
    peakLabel: String,
    modifier: Modifier = Modifier,
) {
    val peak = values.maxOrNull()?.takeIf { it > 0.0 } ?: 1.0
    Column(modifier.fillMaxWidth().clipToBounds()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(176.dp)
                .clipToBounds(),
        ) {
            Canvas(Modifier.fillMaxSize().clipToBounds()) {
                if (values.isEmpty()) return@Canvas
                val left = 6.dp.toPx()
                val right = size.width - 6.dp.toPx()
                val top = 36.dp.toPx()
                val bottom = size.height - 6.dp.toPx()
                val count = values.size
                fun xOf(index: Int): Float = if (count == 1) (left + right) / 2f else left + (right - left) * index / (count - 1)
                fun yOf(value: Double): Float = bottom - ((value / peak) * (bottom - top)).toFloat()
                val line = Path()
                line.moveTo(xOf(0), yOf(values[0]))
                for (index in 1 until count) {
                    val mid = (xOf(index - 1) + xOf(index)) / 2f
                    line.cubicTo(mid, yOf(values[index - 1]), mid, yOf(values[index]), xOf(index), yOf(values[index]))
                }
                val fill = Path().apply {
                    addPath(line)
                    lineTo(xOf(count - 1), bottom)
                    lineTo(xOf(0), bottom)
                    close()
                }
                drawPath(
                    fill,
                    brush = Brush.verticalGradient(
                        colors = listOf(Color(0x665C34FF), Color(0x005C34FF)),
                        startY = top,
                        endY = bottom,
                    ),
                )
                drawPath(
                    line,
                    color = Brand,
                    style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
                val peakIndex = values.indices.maxBy { values[it] }
                val peakPoint = Offset(xOf(peakIndex), yOf(values[peakIndex]))
                drawCircle(Color.White, 7.dp.toPx(), peakPoint)
                drawCircle(Brand, 4.5.dp.toPx(), peakPoint)
            }
            Text(
                peakLabel,
                color = BrandDeep,
                fontFamily = Jakarta,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .clip(RoundedCornerShape(999.dp))
                    .background(BrandWash)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
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

@Composable
fun ShareTrack(fraction: Float, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(RoundedCornerShape(99.dp))
            .background(BrandWash),
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(8.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(color),
        )
    }
}
