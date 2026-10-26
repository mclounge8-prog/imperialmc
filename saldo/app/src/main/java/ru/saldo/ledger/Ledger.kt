package ru.saldo.ledger

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

@Serializable
enum class TxType { INCOME, EXPENSE }

enum class Category(
    val title: String,
    val type: TxType,
    val color: Long,
) {
    GROCERIES("Groceries", TxType.EXPENSE, 0xFF5C34FF),
    TRANSPORT("Transport", TxType.EXPENSE, 0xFF8B6CFF),
    HOME("Housing", TxType.EXPENSE, 0xFF3D2E8A),
    BILLS("Bills", TxType.EXPENSE, 0xFFB7A6FF),
    SHOPPING("Shopping", TxType.EXPENSE, 0xFF241B42),
    LEISURE("Leisure", TxType.EXPENSE, 0xFF6A5A99),
    HEALTH("Health", TxType.EXPENSE, 0xFF4E4478),
    OTHER_EXPENSE("Other", TxType.EXPENSE, 0xFFC4BED4),
    SALARY("Salary", TxType.INCOME, 0xFF5C34FF),
    SIDE("Side income", TxType.INCOME, 0xFF8B6CFF),
    GIFT("Gift", TxType.INCOME, 0xFF3D2E8A),
    OTHER_INCOME("Other", TxType.INCOME, 0xFF6A5A99),
}

@Serializable
data class Tx(
    val id: String,
    val type: TxType,
    val amountMinor: Long,
    val category: String,
    val note: String,
    val epochDay: Long,
    val createdAt: Long,
)

@Serializable
data class Ledger(val transactions: List<Tx> = emptyList())

fun categoriesFor(type: TxType): List<Category> = Category.entries.filter { it.type == type }

fun categoryOf(name: String): Category = Category.entries.firstOrNull { it.name == name } ?: Category.OTHER_EXPENSE

class LedgerRepository(private val file: File) {
    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }
    private val mutex = Any()
    private var current = read()

    fun snapshot(): Ledger = synchronized(mutex) { current }

    fun upsert(tx: Tx) = update { items ->
        items.filterNot { it.id == tx.id } + tx
    }

    fun delete(id: String) = update { items -> items.filterNot { it.id == id } }

    private fun update(block: (List<Tx>) -> List<Tx>) {
        synchronized(mutex) {
            val next = Ledger(
                block(current.transactions).sortedWith(
                    compareByDescending<Tx> { it.epochDay }.thenByDescending { it.createdAt },
                ),
            )
            file.parentFile?.mkdirs()
            file.writeText(json.encodeToString(next))
            current = next
        }
    }

    private fun read(): Ledger {
        if (!file.exists()) return Ledger()
        return runCatching { json.decodeFromString<Ledger>(file.readText()) }.getOrDefault(Ledger())
    }
}

fun newId(): String = UUID.randomUUID().toString()
