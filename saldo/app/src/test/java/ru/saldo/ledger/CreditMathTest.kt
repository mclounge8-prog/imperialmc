package ru.saldo.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CreditMathTest {
    @Test
    fun annuityAtTwelvePercent() {
        val quote = CreditMath.quote(100_000.0, 12.0, 12)
        assertEquals(8884.88, quote!!.payment, 0.02)
        assertEquals(106618.56, quote.total, 0.05)
    }

    @Test
    fun zeroRateSplitsEvenly() {
        val quote = CreditMath.quote(12_000.0, 0.0, 12)
        assertEquals(1000.0, quote!!.payment, 0.001)
        assertEquals(0.0, quote.overpayment, 0.001)
    }

    @Test
    fun rejectsEmptyInput() {
        assertNull(CreditMath.quote(0.0, 10.0, 12))
        assertNull(CreditMath.quote(1000.0, 10.0, 0))
        assertNull(parseAmountToMinor(""))
        assertNull(parseAmountToMinor("0"))
        assertEquals(125050L, parseAmountToMinor("1 250,50"))
    }
}
