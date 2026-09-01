import { escapeHtml } from './escapeHtml.js';
import { formatVenueDateTime } from '../utils/timezone.js';

const METHOD_LABELS = { cash: 'Наличные', card: 'Карта', other: 'Другое' };
const STATUS_LABELS = { paid: 'Оплачен', cancelled: 'Отменён' };

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
    </div>

    <div class="subsection report-summary">
      <div class="report-summary-card">
        <span class="report-summary-label">Оплачено</span>
        <span class="report-summary-value">${summary.paidCount}</span>
        <span class="report-summary-sub">${formatMoney(summary.paidTotal)}</span>
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
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-hint">Чеков за этот период нет</td></tr>'}</tbody>
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

function renderCashDayRow(day) {
  return `
    <tr>
      <td>${formatDay(day.day)}</td>
      <td>${escapeHtml(day.venueName)}</td>
      <td>${day.shiftsCount}</td>
      <td>${day.receiptsCount}</td>
      <td>${formatMoney(day.revenueTotal)}</td>
      <td>${formatMoney(day.cashSales)}</td>
      <td>${formatMoney(day.cardSales)}</td>
      <td>${formatMoney(day.deposits)}</td>
      <td>${formatMoney(day.withdrawals)}</td>
      <td>${formatMoney(day.openingCash)}</td>
      <td>${formatMoney(day.expectedCash)}</td>
      <td>${day.countedShifts > 0 ? formatMoney(day.countedCash) : '—'}</td>
      <td>${day.countedShifts > 0 ? formatMoney(day.difference) : '—'}</td>
    </tr>
  `;
}

function renderCashShiftRow(shift) {
  const statusLabel = shift.status === 'open' ? 'Открыта' : 'Закрыта';
  const statusClass = shift.status === 'open' ? 'badge-active' : 'badge-inactive';
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
      <td>${formatMoney(shift.cardSales)}</td>
      <td>${formatMoney(shift.deposits)}</td>
      <td>${formatMoney(shift.withdrawals)}</td>
      <td>${formatMoney(shift.expectedCash)}</td>
      <td>${shift.countedCash != null ? formatMoney(shift.countedCash) : '—'}</td>
      <td>${shift.difference != null ? formatMoney(shift.difference) : '—'}</td>
      <td>${formatMoney(shift.revenueTotal)}</td>
    </tr>
  `;
}

export function renderCashSection(venues, selectedVenueId, dateFrom, dateTo, byDay, shifts) {
  const dayRows = byDay.map((d) => renderCashDayRow(d)).join('');
  const shiftRows = shifts.map((s) => renderCashShiftRow(s)).join('');
  const revenue = shifts.reduce((sum, s) => sum + s.revenueTotal, 0);
  const cashSales = shifts.reduce((sum, s) => sum + s.cashSales, 0);
  const cardSales = shifts.reduce((sum, s) => sum + s.cardSales, 0);

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
            <th>Карта</th>
            <th>Внесения</th>
            <th>Инкассации</th>
            <th>Начало</th>
            <th>Ожидалось</th>
            <th>Факт</th>
            <th>Разница</th>
          </tr>
        </thead>
        <tbody>${dayRows || '<tr><td colspan="13" class="empty-hint">Смен за период нет</td></tr>'}</tbody>
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
            <th>Карта</th>
            <th>Внесения</th>
            <th>Инкассации</th>
            <th>Ожидалось</th>
            <th>Факт</th>
            <th>Разница</th>
            <th>Выручка</th>
          </tr>
        </thead>
        <tbody>${shiftRows || '<tr><td colspan="17" class="empty-hint">Смен за период нет</td></tr>'}</tbody>
      </table>
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
