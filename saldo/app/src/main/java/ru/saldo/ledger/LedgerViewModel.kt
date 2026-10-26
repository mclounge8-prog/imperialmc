package ru.saldo.ledger

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

class LedgerViewModel(app: Application) : AndroidViewModel(app) {
    private val repository = LedgerRepository(File(app.filesDir, "ledger.json"))
    private val _ledger = MutableStateFlow(repository.snapshot())
    val ledger: StateFlow<Ledger> = _ledger

    fun save(tx: Tx) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.upsert(tx)
            _ledger.value = repository.snapshot()
        }
    }

    fun delete(id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.delete(id)
            _ledger.value = repository.snapshot()
        }
    }
}

class EditorRequest(val type: TxType, val existing: Tx? = null)
