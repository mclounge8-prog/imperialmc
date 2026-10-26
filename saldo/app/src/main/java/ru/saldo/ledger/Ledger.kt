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
    GROCERIES("Продукты", TxType.EXPENSE, 0xFF5C34FF),
    TRANSPORT("Транспорт", TxType.EXPENSE, 0xFF0A7AFF),
    HOME("Жильё", TxType.EXPENSE, 0xFF8B6CFF),
    BILLS("Счета", TxType.EXPENSE, 0xFF3D1FD4),
    SHOPPING("Покупки", TxType.EXPENSE, 0xFFB87900),
    LEISURE("Досуг", TxType.EXPENSE, 0xFF149A4A),
    HEALTH("Здоровье", TxType.EXPENSE, 0xFF0A7EA4),
    OTHER_EXPENSE("Прочее", TxType.EXPENSE, 0xFF6B6B76),
    SALARY("Зарплата", TxType.INCOME, 0xFF1E7A4D),
    SIDE("Подработка", TxType.INCOME, 0xFF2F6F4E),
    GIFT("Подарок", TxType.INCOME, 0xFF3E7A6B),
    OTHER_INCOME("Прочее", TxType.INCOME, 0xFF5C7A62),
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
