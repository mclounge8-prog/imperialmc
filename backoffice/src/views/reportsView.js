import { escapeHtml } from './escapeHtml.js';
import { formatVenueDateTime } from '../utils/timezone.js';

const METHOD_LABELS = { cash: 'Наличные', card: 'Карта', qr: 'QR-код', other: 'Другое' };
const STATUS_LABELS = { paid: 'Оплачен', cancelled: 'Отменён', refunded: 'Возврат' };

export function renderReceiptFiscalBox(receipt, notice) {
  const id = receipt.id;
  const status = receipt.fiscal_status;
  const manual = status === 'held' || receipt.has_fiscal_hold || receipt.fiscal_hold_payload;
  let body = '—';
  if (status === 'held') {
    body = `
      <span class="badge badge-inactive">Ждёт отправки</span>
      <button type="button" class="secondary" hx-post="/reports/receipts/${id}/fiscal-send" hx-target="#receipt-fiscal-${id}" hx-swap="outerHTML">Отправить</button>
    `;
  } else if (status === 'pending') {
    body = `<span class="badge">В очереди на кассу</span>`;
  } else if (status === 'error') {
    const error = receipt.fiscal_last_error
      ? `<div class="fiscal-job-error">${escapeHtml(receipt.fiscal_last_error)}</div>`
      : '';
    body = `
      <span class="badge badge-inactive">Ошибка кассы</span>
      ${error}
      ${
        manual
          ? `<button type="button" class="secondary" hx-post="/reports/receipts/${id}/fiscal-send" hx-target="#receipt-fiscal-${id}" hx-swap="outerHTML">Повторить</button>`
          : ''
      }
    `;
  } else if (status === 'done') {
    body = `<span class="badge badge-active">ФД ${escapeHtml(String(receipt.fiscal_doc_number || '—'))}</span>`;
  }
  const note = notice ? `<div class="fiscal-job-error">${escapeHtml(notice)}</div>` : '';
  return `<div id="receipt-fiscal-${id}" class="receipt-fiscal">${body}${note}</div>`;
}

function formatDateTime(value) {
  return formatVenueDateTime(value);
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} ₽`;
}

function formatDay(isoDay) {
  if (!isoDay) return '—';
  const [y, m, d] = isoDay.split('-');
  return `${d}.${m}.${y}`;
}

function venueOptionsHtml(venues, selectedVenueId) {
  return (
    `<option value="">Все заведения</option>` +
    venues
      .map(
        (v) =>
          `<option value="${v.id}"${String(v.id) === String(selectedVenueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
      )
      .join('')
  );
}

function exportHref(kind, venueId, dateFrom, dateTo, extra = '') {
  const q = new URLSearchParams();
  if (venueId) q.set('venueId', String(venueId));
  if (dateFrom) q.set('from', dateFrom);
  if (dateTo) q.set('to', dateTo);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
  }
  return `/reports/export/${kind}?${q.toString()}`;
}

function renderFiltersBar(actionPath, venues, selectedVenueId, dateFrom, dateTo, exportLinks = []) {
  const exports = exportLinks
    .map(
      (link) =>
        `<a class="btn-secondary report-export-btn" href="${link.href}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`
    )
    .join('');

  return `
    <form
      class="filters-bar"
      hx-get="${actionPath}"
      hx-target="#main-content"
      hx-push-url="false"
    >
      <select name="venueId">${venueOptionsHtml(venues, selectedVenueId)}</select>
      <input type="date" name="from" value="${dateFrom || ''}" placeholder="С">
      <input type="date" name="to" value="${dateTo || ''}" placeholder="По">
      <input type="hidden" name="page" value="1">
      <button type="submit" class="btn-secondary">Применить</button>
      ${exports}
    </form>
  `;
}

function renderReportTabs(active, venueId, dateFrom, dateTo) {
  const venueQ = venueId || '';
  const fromQ = dateFrom || '';
  const toQ = dateTo || '';

  const tab = (key, label, path) => {
    if (key === active) {
      return `<span class="report-tab report-tab-active">${label}</span>`;
    }
    return `
      <a
        class="report-tab"
        hx-get="${path}?venueId=${venueQ}&from=${fromQ}&to=${toQ}"
        hx-target="#main-content"
        hx-push-url="false"
      >${label}</a>
    `;
  };

  return `
    <div class="report-tabs">
      ${tab('receipts', 'Чеки', '/reports/receipts')}
      ${tab('items', 'По блюдам', '/reports/items')}
      ${tab('cash', 'Касса', '/reports/cash')}
    </div>
  `;
}

export function renderReceiptRow(receipt) {
  const statusClass = receipt.status === 'paid' ? 'badge-active' : 'badge-inactive';
  const methods = receipt.payment_methods
    ? receipt.payment_methods
        .split(',')
        .map((m) => METHOD_LABELS[m.trim()] || m.trim())
        .join(', ')
    : '—';
  const tableLabel = receipt.table_name ? escapeHtml(receipt.table_name) : 'Быстрый заказ';
  const precheckBadge =
    receipt.status === 'cancelled' && receipt.precheck_was_printed
      ? ' <span class="badge badge-inactive">после пречека</span>'
      : '';
  const commentHint = receipt.cancel_comment
    ? `<div class="muted" style="font-size:12px;margin-top:2px;">${escapeHtml(receipt.cancel_comment)}</div>`
    : '';
  const discountHint =
    Number(receipt.discount_percent) > 0
      ? `<div class="muted" style="font-size:12px;margin-top:2px;">скидка ${Number(receipt.discount_percent)}%</div>`
      : '';

  return `
    <tr>
      <td>${formatDateTime(receipt.closed_at)}</td>
      <td>${escapeHtml(receipt.venue_name || '—')}</td>
      <td>${tableLabel} · ${escapeHtml(receipt.guest_label || '')}${commentHint}${discountHint}</td>
      <td>${escapeHtml(receipt.staff_name || '—')}</td>
      <td>${methods}</td>
      <td><span class="badge ${statusClass}">${STATUS_LABELS[receipt.status] || receipt.status}</span>${precheckBadge}</td>
      <td>${Number(receipt.total).toFixed(2)} ₽</td>
      <td>${renderReceiptFiscalBox(receipt)}</td>
      <td class="row-actions">
        <button hx-get="/reports/receipts/${receipt.id}" hx-target="#main-content" hx-push-url="false">Открыть</button>
      </td>
    </tr>
  `;
}

export function renderReceiptsSection(venues, selectedVenueId, dateFrom, dateTo, receipts, pagination) {
  const rows = receipts.map((r) => renderReceiptRow(r)).join('');
  const summary = pagination.summary || {
    paidCount: 0,
    cancelledCount: 0,
    paidTotal: 0,
    discountTotal: 0,
  };

  const { page, totalCount, pageSize } = pagination;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIdx = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalCount);

  const venueQ = selectedVenueId || '';
  const fromQ = dateFrom || '';
  const toQ = dateTo || '';

  const paginationHtml = `
    <div class="pagination">
      <span class="pagination-info">
        Показано ${startIdx}–${endIdx} из ${totalCount} · страница ${page} из ${totalPages}
      </span>
      <div class="pagination-buttons">
        <button
          class="btn-secondary"
          ${page <= 1 ? 'disabled' : ''}
          hx-get="/reports/receipts?venueId=${venueQ}&from=${fromQ}&to=${toQ}&page=${page - 1}"
          hx-target="#main-content"
          hx-push-url="false"
        >← Пред.</button>
        <button
          class="btn-secondary"
          ${page >= totalPages ? 'disabled' : ''}
          hx-get="/reports/receipts?venueId=${venueQ}&from=${fromQ}&to=${toQ}&page=${page + 1}"
          hx-target="#main-content"
          hx-push-url="false"
        >След. →</button>
      </div>
    </div>
  `;

  return `
    <header>
      <h1>Отчёты</h1>
      <p>Чеки — полная история расчётов по каждому гостю</p>
    </header>

    <div class="subsection">
      ${renderReportTabs('receipts', selectedVenueId, dateFrom, dateTo)}
      ${renderFiltersBar('/reports/receipts', venues, selectedVenueId, dateFrom, dateTo, [
        {
          label: '⬇ CSV чеки',
          href: exportHref('receipts', selectedVenueId, dateFrom, dateTo),
        },
      ])}
      <p class="hint">По умолчанию — последние 7 дней. CSV выгружает весь выбранный период, не только текущую страницу.</p>
      ${
        Number(summary.heldCount) > 0
          ? `<p class="hint">Наличные чеки ждут ручной отправки в кассу: ${summary.heldCount}. В сумме наличных они уже есть. Z смены печатается как обычно, эти чеки в него не входят. В уже закрытый Z чек добавить нельзя.</p>`
          : ''
      }
    </div>

    <div class="subsection report-summary">
      <div class="report-summary-card">
        <span class="report-summary-label">Оплачено</span>
        <span class="report-summary-value">${summary.paidCount}</span>
        <span class="report-summary-sub">${formatMoney(summary.paidTotal)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Нал</span>
        <span class="report-summary-value">${formatMoney(summary.cashTotal || 0)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Карта</span>
        <span class="report-summary-value">${formatMoney(summary.cardTotal || 0)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">QR-код</span>
        <span class="report-summary-value">${formatMoney(summary.qrTotal || 0)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Отменено</span>
        <span class="report-summary-value">${summary.cancelledCount}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Скидки</span>
        <span class="report-summary-value">${formatMoney(summary.discountTotal)}</span>
      </div>
    </div>

    <div class="subsection">
      <table class="data-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Заведение</th>
            <th>Стол / гость</th>
            <th>Сотрудник</th>
            <th>Оплата</th>
            <th>Статус</th>
            <th>Сумма</th>
            <th>Касса</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty-hint">Чеков за этот период нет</td></tr>'}</tbody>
      </table>
      ${paginationHtml}
    </div>
  `;
}

export function renderItemStatsRow(item) {
  return `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category_name || '—')}</td>
      <td>${item.total_qty}</td>
      <td>${Number(item.total_revenue).toFixed(2)} ₽</td>
    </tr>
  `;
}

export function renderItemStatsSection(venues, selectedVenueId, dateFrom, dateTo, items) {
  const rows = items.map((i) => renderItemStatsRow(i)).join('');
  const grandQty = items.reduce((sum, i) => sum + Number(i.total_qty), 0);
  const grandRevenue = items.reduce((sum, i) => sum + Number(i.total_revenue), 0);

  return `
    <header>
      <h1>Отчёты</h1>
      <p>Статистика продаж по позициям меню</p>
    </header>

    <div class="subsection">
      ${renderReportTabs('items', selectedVenueId, dateFrom, dateTo)}
      ${renderFiltersBar('/reports/items', venues, selectedVenueId, dateFrom, dateTo, [
        { label: '⬇ CSV блюда', href: exportHref('items', selectedVenueId, dateFrom, dateTo) },
      ])}
      <p class="hint">
        Только оплаченные чеки. По умолчанию — последние 7 дней.
      </p>
    </div>

    <div class="subsection">
      <p class="hint">Всего продано: <strong>${grandQty}</strong> позиций на сумму <strong>${grandRevenue.toFixed(2)} ₽</strong></p>
      <table class="data-table">
        <thead>
          <tr><th>Позиция</th><th>Категория</th><th>Кол-во продано</th><th>Выручка</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="empty-hint">За этот период продаж нет</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function renderCashDayRow(day, manualMode) {
  return `
    <tr>
      <td>${formatDay(day.day)}</td>
      <td>${escapeHtml(day.venueName)}</td>
      <td>${day.shiftsCount}</td>
      <td>${day.receiptsCount}</td>
      <td>${formatMoney(day.revenueTotal)}</td>
      <td>${formatMoney(day.cashSales)}</td>
      ${manualMode ? `<td>${formatMoney(day.heldCash || 0)}</td>` : ''}
      <td>${formatMoney(day.cardSales)}</td>
      <td>${formatMoney(day.qrSales)}</td>
      <td>${formatMoney(day.deposits)}</td>
      <td>${formatMoney(day.withdrawals)}</td>
      <td>${formatMoney(day.openingCash)}</td>
      <td>${formatMoney(day.expectedCash)}</td>
      <td>${day.countedShifts > 0 ? formatMoney(day.countedCash) : '—'}</td>
      <td>${day.countedShifts > 0 ? formatMoney(day.difference) : '—'}</td>
    </tr>
  `;
}

function renderCashShiftRow(shift, manualMode) {
  const statusLabel = shift.status === 'open' ? 'Открыта' : 'Закрыта';
  const statusClass = shift.status === 'open' ? 'badge-active' : 'badge-inactive';
  const fiscalCell = !manualMode
    ? ''
    : shift.holdCashReceipts
      ? `<td><button type="button" class="secondary" hx-get="/reports/cash/shifts/${shift.id}/fiscal" hx-target="#cash-fiscal-panel" hx-swap="innerHTML">Сверка / Z</button></td>`
      : '<td>—</td>';
  return `
    <tr>
      <td>${formatDay(shift.day)}</td>
      <td>#${shift.id}</td>
      <td>${escapeHtml(shift.venueName)}</td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td>${formatDateTime(shift.openedAt)}</td>
      <td>${formatDateTime(shift.closedAt)}</td>
      <td>${escapeHtml(shift.openedByName || '—')}</td>
      <td>${escapeHtml(shift.closedByName || '—')}</td>
      <td>${formatMoney(shift.openingCash)}</td>
      <td>${formatMoney(shift.cashSales)}</td>
      ${manualMode ? `<td>${formatMoney(shift.heldCash || 0)}</td>` : ''}
      <td>${formatMoney(shift.cardSales)}</td>
      <td>${formatMoney(shift.qrSales)}</td>
      <td>${formatMoney(shift.deposits)}</td>
      <td>${formatMoney(shift.withdrawals)}</td>
      <td>${formatMoney(shift.expectedCash)}</td>
      <td>${shift.countedCash != null ? formatMoney(shift.countedCash) : '—'}</td>
      <td>${shift.difference != null ? formatMoney(shift.difference) : '—'}</td>
      <td>${formatMoney(shift.revenueTotal)}</td>
      ${fiscalCell}
    </tr>
  `;
}

function reconcileValue(saved, fallback) {
  const n = Number(saved);
  return Number.isFinite(n) ? n.toFixed(2) : Number(fallback || 0).toFixed(2);
}

export function renderShiftFiscalPanel(shift, notice) {
  const saved = shift.fiscalReconcile && typeof shift.fiscalReconcile === 'object' ? shift.fiscalReconcile : {};
  const noncash = Number(shift.cardSales || 0) + Number(shift.qrSales || 0) + Number(shift.otherSales || 0);
  const zLabel =
    shift.zStatus === 'done'
      ? `Z напечатан, ФД ${shift.zDoc || '—'}`
      : shift.zStatus === 'pending' || shift.zStatus === 'in_progress'
        ? 'Z уже в очереди кассы'
        : shift.zStatus === 'error'
          ? 'Z не напечатан'
          : 'Z ещё не отправлялся';
  return `
    <div class="subsection" id="shift-fiscal-${shift.id}">
      <h2>Смена #${shift.id} · ${escapeHtml(shift.venueName || '')}</h2>
      <p class="hint">
        Наличные по чекам ${formatMoney(shift.cashSales)} уже включают неотправленные ${formatMoney(shift.heldCash || 0)}
        (${shift.heldCount || 0} чек.). Безнал по чекам ${formatMoney(noncash)}.
        Касса приняла нал ${formatMoney(shift.atolCash || 0)}, безнал ${formatMoney(shift.atolNoncash || 0)}.
        Поля ниже — сверка для вас и для оператора ОФД. На кассу эти цифры не отправляются: Z касса печатает сама по принятым чекам.
      </p>
      ${notice ? `<p class="fiscal-job-error">${escapeHtml(notice)}</p>` : ''}
      ${shift.zError ? `<p class="fiscal-job-error">${escapeHtml(shift.zError)}</p>` : ''}
      <p><strong>${escapeHtml(zLabel)}</strong></p>
      <form class="section-form" hx-post="/reports/cash/shifts/${shift.id}/reconcile" hx-target="#cash-fiscal-panel" hx-swap="innerHTML">
        <label>Наличные в сверке
          <input type="text" name="cash" value="${reconcileValue(saved.cash, shift.cashSales)}">
        </label>
        <label>Безнал в сверке
          <input type="text" name="noncash" value="${reconcileValue(saved.noncash, noncash)}">
        </label>
        <label>Заметка
          <input type="text" name="note" value="${escapeHtml(saved.note || '')}" placeholder="что ответила касса / ОФД">
        </label>
        <button type="submit">Сохранить сверку</button>
      </form>
      <form hx-post="/reports/cash/shifts/${shift.id}/z" hx-target="#cash-fiscal-panel" hx-swap="innerHTML">
        <button type="submit" class="secondary">Отправить Z на кассу</button>
      </form>
    </div>
  `;
}

export function renderCashSection(venues, selectedVenueId, dateFrom, dateTo, byDay, shifts) {
  const manualMode = shifts.some((s) => s.holdCashReceipts);
  const dayRows = byDay.map((d) => renderCashDayRow(d, manualMode)).join('');
  const shiftRows = shifts.map((s) => renderCashShiftRow(s, manualMode)).join('');
  const revenue = shifts.reduce((sum, s) => sum + s.revenueTotal, 0);
  const cashSales = shifts.reduce((sum, s) => sum + s.cashSales, 0);
  const cardSales = shifts.reduce((sum, s) => sum + s.cardSales, 0);
  const qrSales = shifts.reduce((sum, s) => sum + s.qrSales, 0);

  return `
    <header>
      <h1>Отчёты</h1>
      <p>Касса по дням и сменам — наличные, внесения, инкассации, факт/ожидание</p>
    </header>

    <div class="subsection">
      ${renderReportTabs('cash', selectedVenueId, dateFrom, dateTo)}
      ${renderFiltersBar('/reports/cash', venues, selectedVenueId, dateFrom, dateTo, [
        {
          label: '⬇ CSV по дням',
          href: exportHref('cash', selectedVenueId, dateFrom, dateTo, { mode: 'days' }),
        },
        {
          label: '⬇ CSV по сменам',
          href: exportHref('cash', selectedVenueId, dateFrom, dateTo, { mode: 'shifts' }),
        },
      ])}
      <p class="hint">
        Период считается по дате открытия смены. «По дням» — сумма всех смен заведения за календарный день.
        ${
          manualMode
            ? ' Колонка «Не в АТОЛ» — наличные, которые ждут ручной отправки. В колонке «Нал.» они уже посчитаны.'
            : ''
        }
      </p>
    </div>

    <div class="subsection report-summary">
      <div class="report-summary-card">
        <span class="report-summary-label">Смен</span>
        <span class="report-summary-value">${shifts.length}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Выручка</span>
        <span class="report-summary-value">${formatMoney(revenue)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Наличные</span>
        <span class="report-summary-value">${formatMoney(cashSales)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">Карта</span>
        <span class="report-summary-value">${formatMoney(cardSales)}</span>
      </div>
      <div class="report-summary-card">
        <span class="report-summary-label">QR-код</span>
        <span class="report-summary-value">${formatMoney(qrSales)}</span>
      </div>
    </div>

    <div class="subsection">
      <h2>По дням</h2>
      <table class="data-table data-table-compact">
        <thead>
          <tr>
            <th>День</th>
            <th>Заведение</th>
            <th>Смен</th>
            <th>Чеков</th>
            <th>Выручка</th>
            <th>Нал.</th>
            ${manualMode ? '<th>Не в АТОЛ</th>' : ''}
            <th>Карта</th>
            <th>QR-код</th>
            <th>Внесения</th>
            <th>Инкассации</th>
            <th>Начало</th>
            <th>Ожидалось</th>
            <th>Факт</th>
            <th>Разница</th>
          </tr>
        </thead>
        <tbody>${dayRows || `<tr><td colspan="${manualMode ? 15 : 14}" class="empty-hint">Смен за период нет</td></tr>`}</tbody>
      </table>
    </div>

    <div class="subsection">
      <h2>По сменам</h2>
      <table class="data-table data-table-compact">
        <thead>
          <tr>
            <th>День</th>
            <th>ID</th>
            <th>Заведение</th>
            <th>Статус</th>
            <th>Открыта</th>
            <th>Закрыта</th>
            <th>Открыл</th>
            <th>Закрыл</th>
            <th>Начало</th>
            <th>Нал. продажи</th>
            ${manualMode ? '<th>Не в АТОЛ</th>' : ''}
            <th>Карта</th>
            <th>QR-код</th>
            <th>Внесения</th>
            <th>Инкассации</th>
            <th>Ожидалось</th>
            <th>Факт</th>
            <th>Разница</th>
            <th>Выручка</th>
            ${manualMode ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>${shiftRows || `<tr><td colspan="${manualMode ? 20 : 18}" class="empty-hint">Смен за период нет</td></tr>`}</tbody>
      </table>
      <div id="cash-fiscal-panel"></div>
    </div>
  `;
}

export function renderReceiptDetail(receipt, items, payments) {
  const itemRows = items
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.name)}</td>
        <td>${escapeHtml(i.category_name || '—')}</td>
        <td>${i.qty}</td>
        <td>${Number(i.price).toFixed(2)} ₽</td>
        <td>${Number(i.line_total).toFixed(2)} ₽</td>
      </tr>
    `
    )
    .join('');

  const paymentRows = payments
    .map(
      (p) => `
      <tr>
        <td>${METHOD_LABELS[p.method] || p.method}</td>
        <td>${Number(p.amount).toFixed(2)} ₽</td>
      </tr>
    `
    )
    .join('');

  const tableLabel = receipt.table_name ? escapeHtml(receipt.table_name) : 'Быстрый заказ';

  return `
    <header>
      <h1>Чек №${receipt.id}</h1>
      <p>${formatDateTime(receipt.closed_at)} · ${escapeHtml(receipt.venue_name || '—')}</p>
    </header>

    <button
      class="back-link"
      hx-get="/reports/receipts"
      hx-target="#main-content"
      hx-push-url="false"
    >← Назад к чекам</button>

    <div class="subsection">
      <p><strong>Стол/гость:</strong> ${tableLabel} · ${escapeHtml(receipt.guest_label || '')}</p>
      <p><strong>Сотрудник:</strong> ${escapeHtml(receipt.staff_name || '—')}</p>
      <p><strong>Статус:</strong> ${STATUS_LABELS[receipt.status] || receipt.status}${
        receipt.precheck_was_printed ? ' · был пречек' : ''
      }</p>
      ${
        receipt.cancel_comment
          ? `<p><strong>Комментарий отмены:</strong> ${escapeHtml(receipt.cancel_comment)}</p>`
          : ''
      }
      <p><strong>Открыт:</strong> ${formatDateTime(receipt.opened_at)}</p>
      <p><strong>Закрыт:</strong> ${formatDateTime(receipt.closed_at)}</p>
      <p><strong>Касса АТОЛ:</strong></p>
      ${renderReceiptFiscalBox(receipt)}
      ${
        receipt.fiscal_status === 'held'
          ? `<p class="hint">Чек не уходил в кассу автоматически. «Отправить» ставит его в открытую фискальную смену. Если смена кассы уже закрыта Z-отчётом, кнопка объяснит почему: в закрытый отчёт чек добавить нельзя. Смена кассы живёт не дольше 24 часов.</p>`
          : ''
      }
      <p><strong>Сумма без скидки:</strong> ${Number(receipt.subtotal).toFixed(2)} ₽</p>
      ${
        Number(receipt.discount) > 0.009 || Number(receipt.discount_percent) > 0
          ? `<p><strong>Скидка:</strong> −${Number(receipt.discount).toFixed(2)} ₽${
              receipt.discount_percent ? ` (${Number(receipt.discount_percent)}%)` : ''
            }</p>`
          : ''
      }
    </div>

    <div class="subsection">
      <h2>Позиции</h2>
      <table class="data-table">
        <thead>
          <tr><th>Наименование</th><th>Категория</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>
        </thead>
        <tbody>${itemRows || '<tr><td colspan="5" class="empty-hint">Позиций нет</td></tr>'}</tbody>
      </table>
    </div>

    <div class="subsection">
      <h2>Оплата</h2>
      <table class="data-table">
        <thead><tr><th>Способ</th><th>Сумма</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="2" class="empty-hint">Оплаты нет (чек отменён без оплаты)</td></tr>'}</tbody>
      </table>
      <p class="receipt-total"><strong>Итого: ${Number(receipt.total).toFixed(2)} ₽</strong></p>
    </div>
  `;
}
