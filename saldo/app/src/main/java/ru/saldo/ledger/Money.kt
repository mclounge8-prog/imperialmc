package ru.saldo.ledger

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale
import kotlin.math.abs

fun parseAmountToMinor(raw: String): Long? {
    val cleaned = raw.trim().replace(" ", "").replace("₽", "").replace(',', '.')
    if (cleaned.isEmpty() || cleaned == ".") return null
    val value = cleaned.toBigDecimalOrNull() ?: return null
    if (value <= BigDecimal.ZERO) return null
    if (value.stripTrailingZeros().scale() > 2) return null
    return value.setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValueExact()
}

fun formatRub(minor: Long, withSign: Boolean = false): String {
    val negative = minor < 0
    val absolute = abs(minor)
    val rubles = absolute / 100
    val kopecks = (absolute % 100).toInt()
    val grouped = String.format(Locale.US, "%,d", rubles)
    val body = if (kopecks == 0) "$grouped ₽" else String.format(Locale.US, "%s.%02d ₽", grouped, kopecks)
    return when {
        negative -> "−$body"
        withSign && minor > 0 -> "+$body"
        else -> body
    }
}

data class CreditQuote(
    val payment: Double,
    val total: Double,
    val overpayment: Double,
    val rows: List<CreditRow>,
)

data class CreditRow(
    val month: Int,
    val payment: Double,
    val interest: Double,
    val principalPart: Double,
    val balance: Double,
)

object CreditMath {
    fun quote(principal: Double, annualPercent: Double, months: Int): CreditQuote? {
        if (principal <= 0.0 || months <= 0 || annualPercent < 0.0) return null
        if (months > 360 || principal > 1_000_000_000.0) return null
        val monthlyRate = annualPercent / 100.0 / 12.0
        val rawPayment = if (monthlyRate == 0.0) {
            principal / months
        } else {
            val factor = Math.pow(1.0 + monthlyRate, months.toDouble())
            principal * monthlyRate * factor / (factor - 1.0)
        }
        val payment = round2(rawPayment)
        val rows = ArrayList<CreditRow>(months.coerceAtMost(24))
        var balance = principal
        repeat(months) { index ->
            val interest = round2(balance * monthlyRate)
            val principalPart = round2((payment - interest).coerceAtLeast(0.0))
            balance = round2((balance - principalPart).coerceAtLeast(0.0))
            if (index < 24) {
                rows += CreditRow(index + 1, payment, interest, principalPart, balance)
            }
        }
        val total = round2(payment * months)
        return CreditQuote(payment, total, round2(total - principal), rows)
    }

    private fun round2(value: Double): Double =
        BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).toDouble()
}
