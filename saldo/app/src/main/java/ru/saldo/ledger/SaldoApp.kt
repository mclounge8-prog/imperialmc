@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ru.saldo.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.automirrored.outlined.TrendingDown
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle as MonthStyle
import java.util.Locale

private enum class Tab(val label: String, val icon: ImageVector) {
    Overview("Home", Icons.Outlined.AccountBalanceWallet),
    Income("Income", Icons.AutoMirrored.Outlined.TrendingUp),
    Expense("Expenses", Icons.AutoMirrored.Outlined.TrendingDown),
    Analytics("Insights", Icons.Outlined.PieChart),
    Credit("Credit", Icons.Outlined.Calculate),
}

private val en = Locale.US
private val dayFormat = DateTimeFormatter.ofPattern("d MMMM", en)
private val screenPadding = PaddingValues(start = 20.dp, top = 8.dp, end = 20.dp, bottom = 28.dp)
private val heroBrush = Brush.linearGradient(listOf(Color(0xFF9A7BFF), Brand, BrandDeep))

@Composable
fun SaldoApp(vm: LedgerViewModel = viewModel()) {
    val ledger by vm.ledger.collectAsState()
    var tab by remember { mutableStateOf(Tab.Overview) }
    var editor by remember { mutableStateOf<EditorRequest?>(null) }
    val context = LocalContext.current
    val updater = remember { AppUpdater(context.applicationContext) }
    var update by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { update = updater.check() }

    Box(Modifier.fillMaxSize()) {
        AppCanvas()
        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .navigationBarsPadding()
                        .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Dock(
                        tabs = Tab.entries.map { Triple(it.label, it.icon, tab == it) },
                        onSelect = { index -> tab = Tab.entries[index] },
                        modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
                    )
                }
            },
        ) { inner ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(inner)
                    .statusBarsPadding()
                    .clipToBounds(),
            ) {
                Box(
                    Modifier
                        .align(Alignment.TopCenter)
                        .widthIn(max = 680.dp)
                        .fillMaxWidth()
                        .fillMaxHeight(),
                ) {
                    when (tab) {
                        Tab.Overview -> OverviewScreen(
                            ledger = ledger,
                            update = update,
                            onAddIncome = { editor = EditorRequest(TxType.INCOME) },
                            onAddExpense = { editor = EditorRequest(TxType.EXPENSE) },
                            onOpen = { editor = EditorRequest(it.type, it) },
                            onInsights = { tab = Tab.Analytics },
                            onCredit = { tab = Tab.Credit },
                            onUpdate = update@{
                                val release = (update as? UpdateState.Available)?.release ?: return@update
                                scope.launch {
                                    update = UpdateState.Downloading(release)
                                    val ready = runCatching { updater.download(release) }
                                    update = ready.fold(
                                        onSuccess = { UpdateState.Ready(release, it) },
                                        onFailure = {
                                            UpdateState.Failed(
                                                it.message ?: "Could not download the build",
                                                release.apkUrl,
                                            )
                                        },
                                    )
                                    val file = ready.getOrNull() ?: return@launch
                                    if (updater.canInstall()) updater.install(file) else updater.openInstallPermission()
                                }
                            },
                            onOpenLink = updater::openInBrowser,
                            onInstall = { file -> updater.install(file) },
                        )
                        Tab.Income -> OperationsScreen(TxType.INCOME, ledger, { editor = EditorRequest(TxType.INCOME) }) { editor = EditorRequest(it.type, it) }
                        Tab.Expense -> OperationsScreen(TxType.EXPENSE, ledger, { editor = EditorRequest(TxType.EXPENSE) }) { editor = EditorRequest(it.type, it) }
                        Tab.Analytics -> AnalyticsScreen(ledger)
                        Tab.Credit -> CreditScreen()
                    }
                }
            }
        }
    }

    editor?.let { request ->
        TransactionSheet(
            request = request,
            onDismiss = { editor = null },
            onSave = {
                vm.save(it)
                editor = null
            },
            onDelete = {
                vm.delete(it)
                editor = null
            },
        )
    }
}

@Composable
private fun OverviewScreen(
    ledger: Ledger,
    update: UpdateState,
    onAddIncome: () -> Unit,
    onAddExpense: () -> Unit,
    onOpen: (Tx) -> Unit,
    onInsights: () -> Unit,
    onCredit: () -> Unit,
    onUpdate: () -> Unit,
    onInstall: (java.io.File) -> Unit,
    onOpenLink: (String) -> Unit,
) {
    val today = YearMonth.now()
    val monthItems = ledger.transactions.filter { YearMonth.from(LocalDate.ofEpochDay(it.epochDay)) == today }
    val income = monthItems.filter { it.type == TxType.INCOME }.sumOf { it.amountMinor }
    val expense = monthItems.filter { it.type == TxType.EXPENSE }.sumOf { it.amountMinor }
    val balance = ledger.transactions.sumOf { if (it.type == TxType.INCOME) it.amountMinor else -it.amountMinor }
    val recent = ledger.transactions.take(8)
    LazyColumn(contentPadding = screenPadding, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Wordmark() }
        if (update is UpdateState.Available || update is UpdateState.Downloading || update is UpdateState.Ready || update is UpdateState.Failed) {
            item { UpdateBanner(update, onUpdate, onInstall, onOpenLink) }
        }
        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(32.dp))
                    .background(heroBrush)
                    .padding(22.dp),
            ) {
                Text(
                    today.month.getDisplayName(MonthStyle.FULL, en) + " " + today.year,
                    color = Color.White.copy(alpha = 0.78f),
                    fontFamily = Jakarta,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(8.dp))
                Text("Balance", color = Color.White.copy(alpha = 0.78f), fontFamily = Jakarta, fontSize = 14.sp)
                MoneyText(formatRub(balance), 46.sp, weight = FontWeight.ExtraBold, color = Color.White)
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth()) {
                    HeroStat("Income", formatRub(income), Modifier.weight(1f))
                    HeroStat("Spent", formatRub(expense), Modifier.weight(1f))
                }
                Spacer(Modifier.height(18.dp))
                LightButton("Add entry", onAddExpense)
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                ActionOrb(Icons.AutoMirrored.Outlined.TrendingUp, "Income", onAddIncome, Modifier.weight(1f))
                ActionOrb(Icons.AutoMirrored.Outlined.TrendingDown, "Expense", onAddExpense, Modifier.weight(1f))
                ActionOrb(Icons.Outlined.PieChart, "Insights", onInsights, Modifier.weight(1f))
                ActionOrb(Icons.Outlined.Calculate, "Credit", onCredit, Modifier.weight(1f))
            }
        }
        item { SectionHeading("Recent") }
        if (recent.isEmpty()) {
            item { EmptyBlock("Nothing here yet", "Add the first income or expense. The numbers stay on this phone.", onAddExpense) }
        } else {
            item {
                SheetGroup {
                    recent.forEachIndexed { index, tx -> LedgerRow(tx, onOpen, showDivider = index > 0) }
                }
            }
        }
        item {
            Text(
                "Version ${BuildConfig.VERSION_NAME}",
                color = Muted,
                fontFamily = Jakarta,
                fontSize = 12.sp,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
    }
}

@Composable
private fun HeroStat(label: String, value: String, modifier: Modifier) {
    Column(modifier) {
        Text(label, color = Color.White.copy(alpha = 0.72f), fontFamily = Jakarta, fontSize = 12.sp)
        Spacer(Modifier.height(2.dp))
        MoneyText(value, 16.sp, weight = FontWeight.Bold, color = Color.White)
    }
}

@Composable
private fun OperationsScreen(
    type: TxType,
    ledger: Ledger,
    onAdd: () -> Unit,
    onOpen: (Tx) -> Unit,
) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    val items = ledger.transactions.filter {
        it.type == type && YearMonth.from(LocalDate.ofEpochDay(it.epochDay)) == month
    }
    val total = items.sumOf { it.amountMinor }
    LazyColumn(contentPadding = screenPadding, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            ScreenTitle(if (type == TxType.INCOME) "Income" else "Expenses")
            MonthSwitcher(month, { month = month.minusMonths(1) }, { if (month < YearMonth.now()) month = month.plusMonths(1) })
            Spacer(Modifier.height(14.dp))
            MoneyText(formatRub(total), 44.sp, weight = FontWeight.ExtraBold)
            Spacer(Modifier.height(14.dp))
            PrimaryButton(
                if (type == TxType.INCOME) "New income" else "New expense",
                onAdd,
                Modifier.fillMaxWidth(),
            )
        }
        if (items.isEmpty()) {
            item { EmptyBlock("No entries this month", "Change the month or add one.", onAdd) }
        } else {
            item {
                SheetGroup {
                    items.forEachIndexed { index, tx -> LedgerRow(tx, onOpen, showDivider = index > 0) }
                }
            }
        }
    }
}

@Composable
private fun AnalyticsScreen(ledger: Ledger) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    val monthItems = ledger.transactions.filter { YearMonth.from(LocalDate.ofEpochDay(it.epochDay)) == month }
    val income = monthItems.filter { it.type == TxType.INCOME }.sumOf { it.amountMinor }
    val expense = monthItems.filter { it.type == TxType.EXPENSE }.sumOf { it.amountMinor }
    val slices = monthItems.filter { it.type == TxType.EXPENSE }
        .groupBy { it.category }
        .map { (name, txs) -> categoryOf(name) to txs.sumOf { it.amountMinor } }
        .sortedByDescending { it.second }
    val months = (5 downTo 0).map { month.minusMonths(it.toLong()) }
    val columnValues = months.map { ym ->
        ledger.transactions.filter {
            it.type == TxType.EXPENSE && YearMonth.from(LocalDate.ofEpochDay(it.epochDay)) == ym
        }.sumOf { it.amountMinor } / 100.0
    }
    val labels = months.map { it.month.getDisplayName(MonthStyle.SHORT, en).replace(".", "") }
    val peakMinor = columnValues.maxOrNull()?.let { Math.round(it * 100.0) } ?: 0L
    LazyColumn(contentPadding = screenPadding, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            ScreenTitle("Insights")
            MonthSwitcher(month, { month = month.minusMonths(1) }, { if (month < YearMonth.now()) month = month.plusMonths(1) })
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MiniStat("Income", formatRub(income), Modifier.weight(1f))
                MiniStat("Spent", formatRub(expense), Modifier.weight(1f))
            }
        }
        item {
            SheetGroup {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                    Text("Six months of spending", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Ink)
                    Text("Spending across the last six months.", color = Muted, fontFamily = Jakarta, fontSize = 13.sp)
                    Spacer(Modifier.height(8.dp))
                    if (columnValues.all { it == 0.0 }) {
                        Text("Not enough to draw a chart.", color = Muted, fontFamily = Jakarta)
                    } else {
                        SpendingCurve(columnValues, labels, formatRub(peakMinor))
                    }
                }
            }
        }
        item {
            SheetGroup {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                    Text("Where the money went", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Ink)
                    if (slices.isEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text("No expenses this month.", color = Muted, fontFamily = Jakarta)
                    } else {
                        ExpenseDonut(
                            values = slices.map { it.second.toFloat() },
                            colors = slices.map { Color(it.first.color) },
                            centerValue = formatRub(expense),
                        )
                        slices.forEach { (category, amount) ->
                            ShareRow(category, amount, expense)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MiniStat(label: String, value: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(24.dp))
            .background(Sheet)
            .padding(16.dp),
    ) {
        Text(label, color = Muted, fontFamily = Jakarta, fontSize = 13.sp)
        Spacer(Modifier.height(6.dp))
        MoneyText(value, 18.sp, weight = FontWeight.Bold)
    }
}

@Composable
private fun CreditScreen() {
    var amount by remember { mutableStateOf("100000") }
    var months by remember { mutableStateOf("12") }
    var rate by remember { mutableStateOf("12") }
    val principal = amount.replace(" ", "").replace(',', '.').toDoubleOrNull()
    val term = months.toIntOrNull()
    val annual = rate.replace(',', '.').toDoubleOrNull()
    val quote = if (principal != null && term != null && annual != null) CreditMath.quote(principal, annual, term) else null
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenTitle("Credit calculator")
        Text(
            "Annuity: the same payment every month. This is a calculation, not an application.",
            color = Muted,
            fontFamily = Jakarta,
            fontSize = 14.sp,
        )
        NumberField("Amount, ₽", amount) { amount = it }
        NumberField("Term, months", months) { months = it.filter { ch -> ch.isDigit() }.take(3) }
        NumberField("Rate, % per year", rate) { rate = it }
        if (quote == null) {
            Text("Enter an amount above zero, a term from 1 to 360 months, and a rate from 0.", color = Muted, fontFamily = Jakarta)
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(32.dp))
                    .background(heroBrush)
                    .padding(22.dp),
            ) {
                Text("Monthly payment", color = Color.White.copy(alpha = 0.78f), fontFamily = Jakarta, fontSize = 14.sp)
                MoneyText(money(quote.payment), 44.sp, weight = FontWeight.ExtraBold, color = Color.White)
            }
            SheetGroup {
                QuietLine("Total to repay", money(quote.total), false)
                QuietLine("Interest", money(quote.overpayment), true)
            }
            SectionHeading("First ${quote.rows.size} months")
            SheetGroup {
                quote.rows.forEachIndexed { index, row ->
                    if (index > 0) GroupDivider()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(28.dp).clip(CircleShape).background(BrandWash),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("${row.month}", fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = BrandDeep)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            MoneyText(money(row.payment), 15.sp)
                            Text(
                                "interest ${money(row.interest)} · principal ${money(row.principalPart)}",
                                color = Muted,
                                fontFamily = Jakarta,
                                fontSize = 12.sp,
                            )
                        }
                        MoneyText(money(row.balance), 13.sp, weight = FontWeight.Medium)
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun TransactionSheet(
    request: EditorRequest,
    onDismiss: () -> Unit,
    onSave: (Tx) -> Unit,
    onDelete: (String) -> Unit,
) {
    val existing = request.existing
    var type by remember { mutableStateOf(existing?.type ?: request.type) }
    var amount by remember { mutableStateOf(existing?.let { (it.amountMinor / 100.0).toClean() } ?: "") }
    var category by remember { mutableStateOf(existing?.let { categoryOf(it.category) } ?: categoriesFor(type).first()) }
    var note by remember { mutableStateOf(existing?.note ?: "") }
    var day by remember { mutableStateOf(existing?.let { LocalDate.ofEpochDay(it.epochDay) } ?: LocalDate.now()) }
    var pickDate by remember { mutableStateOf(false) }
    val minor = parseAmountToMinor(amount)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Paper,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (existing == null) "New entry" else "Entry",
                fontFamily = Jakarta,
                fontWeight = FontWeight.SemiBold,
                fontSize = 28.sp,
                color = Ink,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceChip("Income", type == TxType.INCOME, onClick = {
                    type = TxType.INCOME
                    if (category.type != TxType.INCOME) category = Category.SALARY
                })
                ChoiceChip("Expense", type == TxType.EXPENSE, onClick = {
                    type = TxType.EXPENSE
                    if (category.type != TxType.EXPENSE) category = Category.GROCERIES
                })
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(28.dp))
                    .background(Sheet)
                    .padding(horizontal = 18.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Amount", color = Muted, fontFamily = Jakarta, fontSize = 13.sp)
                MoneyText(if (amount.isBlank()) "0 ₽" else "${amount.trim()} ₽", 40.sp, weight = FontWeight.ExtraBold)
            }
            AmountKeypad(onKey = { amount = pushAmountKey(amount, it) })
            Text("Category", color = Muted, fontFamily = Jakarta, fontSize = 13.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                categoriesFor(type).forEach { item ->
                    ChoiceChip(item.title, item == category, onClick = { category = item }, leading = {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(Color(item.color)))
                    })
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Sheet)
                    .border(1.dp, Line, RoundedCornerShape(18.dp))
                    .clickable(role = Role.Button) { pickDate = true }
                    .padding(14.dp),
            ) {
                Column {
                    Text("Date", color = Muted, fontFamily = Jakarta, fontSize = 12.sp)
                    Text(day.format(dayFormat), fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Ink)
                }
            }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(80) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Note") },
                singleLine = true,
                colors = fieldColors(),
                shape = RoundedCornerShape(16.dp),
            )
            PrimaryButton(
                "Save",
                onClick = {
                    val value = minor ?: return@PrimaryButton
                    onSave(
                        Tx(
                            id = existing?.id ?: newId(),
                            type = type,
                            amountMinor = value,
                            category = category.name,
                            note = note.trim(),
                            epochDay = day.toEpochDay(),
                            createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                        ),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = minor != null,
            )
            if (existing != null) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(999.dp))
                        .clickable(role = Role.Button) { onDelete(existing.id) }
                        .padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Delete, contentDescription = null, tint = Muted)
                    Spacer(Modifier.width(6.dp))
                    Text("Delete", color = Muted, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
    if (pickDate) {
        val state = rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis ->
                        day = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
                    }
                    pickDate = false
                }) { Text("Done", color = Brand, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { pickDate = false }) {
                    Text("Cancel", color = Muted, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold)
                }
            },
        ) { DatePicker(state = state) }
    }
}

@Composable
private fun AmountKeypad(onKey: (String) -> Unit) {
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(".", "0", "⌫"))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { key ->
                    Box(
                        Modifier
                            .weight(1f)
                            .height(52.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Sheet)
                            .clickable(role = Role.Button) { onKey(key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (key == "⌫") {
                            Icon(Icons.AutoMirrored.Outlined.Backspace, contentDescription = "Delete digit", tint = Ink)
                        } else {
                            Text(key, color = Ink, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
                        }
                    }
                }
            }
        }
    }
}

private fun pushAmountKey(current: String, key: String): String {
    val raw = current.trim()
    if (key == "⌫") return raw.dropLast(1)
    if (key == ".") {
        if (raw.contains('.')) return raw
        return if (raw.isEmpty()) "0." else "$raw."
    }
    val next = if (raw == "0") key else raw + key
    val fraction = next.substringAfter('.', "")
    if (next.contains('.') && fraction.length > 2) return raw
    if (next.substringBefore('.').length > 9) return raw
    return next
}

@Composable
private fun ScreenTitle(text: String) {
    Text(text, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, color = Ink, letterSpacing = (-0.8).sp)
}

@Composable
private fun SectionHeading(title: String) {
    Text(
        title,
        fontFamily = Jakarta,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        color = Ink,
        modifier = Modifier.padding(start = 2.dp),
    )
}

@Composable
private fun QuietLine(label: String, value: String, divider: Boolean) {
    if (divider) {
        Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(1.dp).background(Line))
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Muted, fontFamily = Jakarta, fontSize = 15.sp)
        MoneyText(value, 16.sp)
    }
}

@Composable
private fun LedgerRow(tx: Tx, onOpen: (Tx) -> Unit, showDivider: Boolean) {
    val category = categoryOf(tx.category)
    val positive = tx.type == TxType.INCOME
    if (showDivider) GroupDivider(68.dp)
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(tx) }.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(42.dp).clip(CircleShape).background(Color(category.color).copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(Color(category.color)))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(category.title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp)
            Text(
                listOf(LocalDate.ofEpochDay(tx.epochDay).format(dayFormat), tx.note).filter { it.isNotBlank() }.joinToString(" · "),
                color = Muted,
                fontFamily = Jakarta,
                fontSize = 12.sp,
            )
        }
        MoneyText(formatRub(if (positive) tx.amountMinor else -tx.amountMinor, withSign = true), 15.sp)
    }
}

@Composable
private fun ShareRow(category: Category, amount: Long, total: Long) {
    val fraction = if (total == 0L) 0f else amount.toFloat() / total.toFloat()
    Column(Modifier.padding(top = 14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(Color(category.color)))
                Spacer(Modifier.width(8.dp))
                Text(category.title, fontFamily = Jakarta, fontWeight = FontWeight.Medium, color = Ink)
            }
            MoneyText(formatRub(amount), 14.sp, weight = FontWeight.Medium)
        }
        Spacer(Modifier.height(8.dp))
        ShareTrack(fraction, Color(category.color))
    }
}

@Composable
private fun MonthSwitcher(month: YearMonth, onPrev: () -> Unit, onNext: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(Sheet)
            .padding(horizontal = 4.dp, vertical = 2.dp),
    ) {
        Stepper(Icons.Outlined.ChevronLeft, "Previous month", true, onPrev)
        Text(
            month.month.getDisplayName(MonthStyle.FULL, en) + " " + month.year,
            fontFamily = Jakarta,
            fontWeight = FontWeight.SemiBold,
            color = Ink,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Stepper(Icons.Outlined.ChevronRight, "Next month", month < YearMonth.now(), onNext)
    }
}

@Composable
private fun Stepper(icon: ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = if (enabled) Brand else Line)
    }
}

@Composable
private fun EmptyBlock(title: String, body: String, onAdd: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(Sheet)
            .padding(18.dp),
    ) {
        Text(title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = Ink)
        Spacer(Modifier.height(6.dp))
        Text(body, color = Muted, fontFamily = Jakarta)
        Spacer(Modifier.height(14.dp))
        PrimaryButton("Add entry", onAdd)
    }
}

@Composable
private fun UpdateBanner(
    state: UpdateState,
    onUpdate: () -> Unit,
    onInstall: (java.io.File) -> Unit,
    onOpenLink: (String) -> Unit,
) {
    when (state) {
        is UpdateState.Available -> Banner("Version ${state.release.versionName} is ready", state.release.notes.ifBlank { "Tap to download and install." }, "Update", onUpdate)
        is UpdateState.Downloading -> Banner("Downloading ${state.release.versionName}", "The file is coming straight from the server.", null, {})
        is UpdateState.Ready -> Banner("Build downloaded", "Confirm the Android install. If the prompt did not open, tap again.", "Install", { onInstall(state.file) })
        is UpdateState.Failed -> Banner(
            "Update",
            state.message,
            if (state.apkUrl != null) "Open in browser" else null,
            { state.apkUrl?.let(onOpenLink) },
        )
        else -> Unit
    }
}

@Composable
private fun Banner(title: String, body: String, action: String?, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(BrandWash)
            .padding(16.dp),
    ) {
        Text(title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, color = BrandDeep)
        Text(body, fontFamily = Jakarta, color = Ink, fontSize = 13.sp)
        if (action != null) {
            Spacer(Modifier.height(12.dp))
            PrimaryButton(action, onClick)
        }
    }
}

@Composable
private fun fieldColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Brand,
    unfocusedBorderColor = Line,
    focusedLabelColor = BrandDeep,
    unfocusedLabelColor = Muted,
    cursorColor = Brand,
    focusedTextColor = Ink,
    unfocusedTextColor = Ink,
    focusedContainerColor = Sheet,
    unfocusedContainerColor = Sheet,
)

@Composable
private fun NumberField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        textStyle = TextStyle(fontFamily = Jakarta, fontSize = 18.sp, color = Ink, fontFeatureSettings = "tnum"),
        colors = fieldColors(),
        shape = RoundedCornerShape(18.dp),
    )
}

private fun Double.toClean(): String = if (this % 1.0 == 0.0) toInt().toString() else toString()

private fun money(value: Double): String = formatRub(Math.round(value * 100.0))
