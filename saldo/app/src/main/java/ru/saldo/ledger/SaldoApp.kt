@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ru.saldo.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.TrendingDown
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

private enum class Tab(val label: String, val icon: ImageVector) {
    Overview("Home", Icons.Outlined.AccountBalanceWallet),
    Income("Income", Icons.Outlined.TrendingUp),
    Expense("Expenses", Icons.Outlined.TrendingDown),
    Analytics("Insights", Icons.Outlined.PieChart),
    Credit("Credit", Icons.Outlined.Calculate),
}

private val en = Locale.US
private val dayFormat = DateTimeFormatter.ofPattern("d MMMM", en)
private val screenPadding = PaddingValues(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 124.dp)

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

    val wallpaper = rememberLayerBackdrop()
    val page = rememberLayerBackdrop()

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().layerBackdrop(page)) {
            Box(Modifier.fillMaxSize().layerBackdrop(wallpaper)) {
                AuroraBackground()
            }
            CompositionLocalProvider(LocalBackdrop provides wallpaper) {
                Box(Modifier.fillMaxSize().statusBarsPadding()) {
            when (tab) {
                Tab.Overview -> OverviewScreen(
                    ledger = ledger,
                    update = update,
                    onAdd = { editor = EditorRequest(TxType.EXPENSE) },
                    onOpen = { editor = EditorRequest(it.type, it) },
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
        GlassNav(
            tabs = Tab.entries.map { Triple(it.label, it.icon, tab == it) },
            backdrop = page,
            onSelect = { index -> tab = Tab.entries[index] },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, bottom = 18.dp),
        )
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
    onAdd: () -> Unit,
    onOpen: (Tx) -> Unit,
    onUpdate: () -> Unit,
    onInstall: (java.io.File) -> Unit,
    onOpenLink: (String) -> Unit,
) {
    val today = YearMonth.now()
    val monthItems = ledger.transactions.filter { YearMonth.from(LocalDate.ofEpochDay(it.epochDay)) == today }
    val income = monthItems.filter { it.type == TxType.INCOME }.sumOf { it.amountMinor }
    val expense = monthItems.filter { it.type == TxType.EXPENSE }.sumOf { it.amountMinor }
    val balance = ledger.transactions.sumOf { if (it.type == TxType.INCOME) it.amountMinor else -it.amountMinor }
    val recent = ledger.transactions.take(12)
    LazyColumn(
        contentPadding = screenPadding,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item { BrandLockup() }
        if (update is UpdateState.Available || update is UpdateState.Downloading || update is UpdateState.Ready || update is UpdateState.Failed) {
            item { UpdateBanner(update, onUpdate, onInstall, onOpenLink) }
        }
        item {
            Column(Modifier.padding(start = 4.dp, top = 6.dp)) {
                Text("Balance", color = Muted, fontFamily = Jakarta, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                MoneyText(formatRub(balance), 52.sp, weight = FontWeight.ExtraBold)
                Text("Everything kept on this phone", color = Muted, fontFamily = Jakarta, fontSize = 14.sp)
            }
        }
        item {
            SectionHeading("This month")
            GlassGroup {
                QuietLine("Income", formatRub(income), false)
                QuietLine("Expenses", formatRub(expense), true)
            }
        }
        item { SectionHeading("Recent", "Add", onAdd) }
        if (recent.isEmpty()) {
            item { EmptyBlock("Nothing here yet", "Add the first income or expense. The numbers stay on this phone.", onAdd) }
        } else {
            item {
                GlassGroup {
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
                modifier = Modifier.padding(start = 4.dp, bottom = 8.dp),
            )
        }
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
    LazyColumn(contentPadding = screenPadding, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item {
            ScreenTitle(if (type == TxType.INCOME) "Income" else "Expenses")
            MonthSwitcher(month, { month = month.minusMonths(1) }, { if (month < YearMonth.now()) month = month.plusMonths(1) })
            Spacer(Modifier.height(10.dp))
            MoneyText(formatRub(total), 44.sp, weight = FontWeight.ExtraBold)
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onAdd,
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Color.White),
            ) { Text(if (type == TxType.INCOME) "New income" else "New expense", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold) }
        }
        if (items.isEmpty()) {
            item { EmptyBlock("No entries this month", "Change the month or add one.", onAdd) }
        } else {
            item {
                GlassGroup {
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
    val labels = months.map { it.month.getDisplayName(TextStyle.SHORT, en).replace(".", "") }
    LazyColumn(contentPadding = screenPadding, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item {
            ScreenTitle("Insights")
            MonthSwitcher(month, { month = month.minusMonths(1) }, { if (month < YearMonth.now()) month = month.plusMonths(1) })
        }
        item {
            GlassGroup {
                QuietLine("Income", formatRub(income), false)
                QuietLine("Expenses", formatRub(expense), true)
            }
        }
        item {
            GlassGroup {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
                    Text("Where the money went", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Ink)
                    Spacer(Modifier.height(8.dp))
                    if (slices.isEmpty()) {
                        Text("No expenses this month.", color = Muted, fontFamily = Jakarta)
                    } else {
                        ExpenseDonut(
                            values = slices.map { it.second.toFloat() },
                            colors = slices.map { Color(it.first.color) },
                        )
                        slices.forEach { (category, amount) ->
                            ShareRow(category, amount, expense)
                        }
                    }
                }
            }
        }
        item {
            GlassGroup {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
                    Text("Six months of spending", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Ink)
                    Spacer(Modifier.height(8.dp))
                    if (columnValues.all { it == 0.0 }) {
                        Text("Not enough to draw a chart.", color = Muted, fontFamily = Jakarta)
                    } else {
                        MonthColumns(columnValues, labels)
                    }
                }
            }
        }
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
        Text("Annuity: the same payment every month. This is a calculation, not an application.", color = Muted, fontFamily = Jakarta, fontSize = 14.sp)
        NumberField("Amount, ₽", amount) { amount = it }
        NumberField("Term, months", months) { months = it.filter { ch -> ch.isDigit() }.take(3) }
        NumberField("Rate, % per year", rate) { rate = it }
        if (quote == null) {
            Text("Enter an amount above zero, a term from 1 to 360 months, and a rate from 0.", color = Muted, fontFamily = Jakarta)
        } else {
            Column(Modifier.padding(start = 4.dp, top = 8.dp)) {
                Text("Monthly payment", color = Muted, fontFamily = Jakarta, fontSize = 14.sp)
                MoneyText(money(quote.payment), 48.sp, weight = FontWeight.ExtraBold)
            }
            GlassGroup {
                QuietLine("Total to repay", money(quote.total), false)
                QuietLine("Interest", money(quote.overpayment), true)
            }
            SectionHeading("First ${quote.rows.size} months")
            GlassGroup {
                quote.rows.forEachIndexed { index, row ->
                    if (index > 0) GroupDivider()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${row.month}", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Muted, modifier = Modifier.width(28.dp))
                        Column(Modifier.weight(1f)) {
                            MoneyText(money(row.payment), 15.sp)
                            Text("interest ${money(row.interest)} · principal ${money(row.principalPart)}", color = Muted, fontFamily = Jakarta, fontSize = 12.sp)
                        }
                        MoneyText(money(row.balance), 13.sp, weight = FontWeight.Medium)
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
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

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Color(0xFFF7F6FA), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (existing == null) "New entry" else "Entry", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 28.sp, color = Ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TypeChip("Income", type == TxType.INCOME) {
                    type = TxType.INCOME
                    if (category.type != TxType.INCOME) category = Category.SALARY
                }
                TypeChip("Expense", type == TxType.EXPENSE) {
                    type = TxType.EXPENSE
                    if (category.type != TxType.EXPENSE) category = Category.GROCERIES
                }
            }
            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Amount") },
                suffix = { Text("₽") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Jakarta, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, color = Ink, fontFeatureSettings = "tnum"),
                colors = fieldColors(),
            )
            Text("Category", color = Muted, fontFamily = Jakarta, fontSize = 13.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                categoriesFor(type).forEach { item ->
                    val selected = item == category
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (selected) Ink else Color.White,
                        modifier = Modifier.clickable { category = item },
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(7.dp).clip(CircleShape).background(Color(item.color)))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                item.title,
                                color = if (selected) Color.White else Ink,
                                fontFamily = Jakarta,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
            }
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = Color.White,
                modifier = Modifier.fillMaxWidth().clickable { pickDate = true },
            ) {
                Column(Modifier.padding(14.dp)) {
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
            )
            Button(
                onClick = {
                    val value = minor ?: return@Button
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
                enabled = minor != null,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Color.White),
            ) { Text("Save", fontFamily = Jakarta, fontWeight = FontWeight.SemiBold) }
            if (existing != null) {
                TextButton(onClick = { onDelete(existing.id) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Delete, contentDescription = null, tint = Muted)
                    Spacer(Modifier.width(6.dp))
                    Text("Delete", color = Muted, fontFamily = Jakarta)
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
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
}

@Composable
private fun ScreenTitle(text: String) {
    Text(text, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, color = Ink, letterSpacing = (-0.6).sp)
}

@Composable
private fun SectionHeading(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Ink)
        if (action != null && onAction != null) {
            Text(action, color = Muted, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onAction))
        }
    }
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
    if (showDivider) GroupDivider(52.dp)
    Row(
        Modifier.fillMaxWidth().clickable { onOpen(tx) }.padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(Color(category.color).copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(Color(category.color)))
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
    Column(Modifier.padding(top = 10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(category.title, fontFamily = Jakarta, fontWeight = FontWeight.Medium, color = Ink)
            MoneyText(formatRub(amount), 14.sp, weight = FontWeight.Medium)
        }
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)),
            color = Color(category.color),
            trackColor = Line,
        )
    }
}

@Composable
private fun MonthSwitcher(month: YearMonth, onPrev: () -> Unit, onNext: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrev) { Icon(Icons.Outlined.ChevronLeft, contentDescription = "Previous month") }
        Text(
            month.month.getDisplayName(TextStyle.FULL, en) + " " + month.year,
            fontFamily = Jakarta,
            fontWeight = FontWeight.SemiBold,
            color = Ink,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        IconButton(onClick = onNext, enabled = month < YearMonth.now()) {
            Icon(Icons.Outlined.ChevronRight, contentDescription = "Next month")
        }
    }
}

@Composable
private fun EmptyBlock(title: String, body: String, onAdd: () -> Unit) {
    Column(Modifier.fillMaxWidth().glass(28.dp, Color.White.copy(alpha = 0.62f)).padding(18.dp)) {
            Text(title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = Ink)
            Spacer(Modifier.height(6.dp))
            Text(body, color = Muted, fontFamily = Jakarta)
            Spacer(Modifier.height(8.dp))
            Text("Add entry", color = Ink, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onAdd).padding(vertical = 6.dp))
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
    Column(Modifier.fillMaxWidth().glass(22.dp, Color.White.copy(alpha = 0.7f), lens = false).padding(16.dp)) {
        Text(title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(body, fontFamily = Jakarta, color = Muted, fontSize = 13.sp)
        if (action != null) {
            Text(action, color = Ink, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp).clickable(onClick = onClick))
        }
    }
}

@Composable
private fun TypeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(999.dp), color = if (selected) Ink else Color.White, modifier = Modifier.clickable(onClick = onClick)) {
        Text(label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = if (selected) Color.White else Ink, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun fieldColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Ink,
    unfocusedBorderColor = Line,
    focusedLabelColor = Muted,
    unfocusedLabelColor = Muted,
    cursorColor = Ink,
    focusedTextColor = Ink,
    unfocusedTextColor = Ink,
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
        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Jakarta, fontSize = 18.sp, color = Ink, fontFeatureSettings = "tnum"),
        colors = fieldColors(),
    )
}

private fun Double.toClean(): String = if (this % 1.0 == 0.0) toInt().toString() else toString()

private fun money(value: Double): String = formatRub(Math.round(value * 100.0))
