import { escapeHtml } from './escapeHtml.js';
import { formatVenueDateTime } from '../utils/timezone.js';

function channelStatusBadge(ch) {
  const ready = ch.enabled && ch.hasToken && ch.hasChatId;
  if (ready) return '<span class="hint" style="color:#2a7a3a;font-weight:600;">активен</span>';
  if (!ch.hasToken || !ch.hasChatId) {
    return '<span class="field-error" style="font-weight:600;">не настроен</span>';
  }
  return '<span class="muted" style="font-weight:600;">выключен</span>';
}

function renderChannelCard(ch) {
  const venues =
    ch.venues && ch.venues.length
      ? ch.venues.map((v) => escapeHtml(v.name)).join(', ')
      : '<em class="muted">нет привязанных точек</em>';
  const bot = ch.botUsername
    ? `@${escapeHtml(ch.botUsername)}`
    : ch.key === 'mc_lounge'
      ? 'текущий бот (MC Lounge)'
      : '—';
  const chat = ch.chatId ? `<code>${escapeHtml(ch.chatId)}</code>` : '<em class="muted">не задан</em>';
  const token = ch.hasToken ? '•••••••• (задан)' : '<em class="muted">не задан</em>';

  return `
    <div class="card" style="margin-bottom:.85rem;padding:1rem 1.1rem;">
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:1rem;">${escapeHtml(ch.name)}</h3>
        ${channelStatusBadge(ch)}
      </div>
      <ul style="margin:.55rem 0 0;padding-left:1.1rem;line-height:1.55;font-size:.92rem;">
        <li>Ключ: <code>${escapeHtml(ch.key)}</code></li>
        <li>Бот: ${bot}</li>
        <li>Токен: ${token}</li>
        <li>Chat ID: ${chat}</li>
        <li>Точки: ${venues}</li>
      </ul>
    </div>
  `;
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} ₽`;
}

function venueFilterOptions(venues, selectedVenueId) {
  return (
    `<option value="">Все заведения</option>` +
    (venues || [])
      .map(
        (v) =>
          `<option value="${v.id}"${String(v.id) === String(selectedVenueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
      )
      .join('')
  );
}

function renderResendShiftRow(shift) {
  return `
    <tr>
      <td>#${shift.id}</td>
      <td>${escapeHtml(shift.venueName)}</td>
      <td>${escapeHtml(formatVenueDateTime(shift.closedAt))}</td>
      <td>${escapeHtml(shift.closedByName || '—')}</td>
      <td>${formatMoney(shift.revenueTotal)}</td>
      <td>
        <form hx-post="/telegram/resend-shift" hx-target="#main-content" hx-swap="innerHTML">
          <input type="hidden" name="shift_id" value="${shift.id}" />
          <button type="submit" class="btn-secondary">Отправить в Telegram</button>
        </form>
      </td>
    </tr>
  `;
}

export function renderTelegramSection(settings, flash = null, channels = [], extras = {}) {
  const enabled = !!settings.enabled;
  const tokenDisplay = settings.hasToken ? '•••••••• (задан)' : 'не задан';
  const chatDisplay = settings.chatId ? escapeHtml(settings.chatId) : 'не задан';
  const flashHtml = flash
    ? `<p class="${flash.ok ? 'hint' : 'field-error'}" style="margin-bottom:1rem;">${escapeHtml(flash.text)}</p>`
    : '';

  const channelCards = (channels || []).map(renderChannelCard).join('') ||
    '<p class="muted">Каналы ещё не созданы — выполните миграцию telegram_channels.</p>';

  return `
    <header>
      <h1>Telegram</h1>
      <p>
        Алерты идут <strong>в 3 разные группы / бота</strong> в зависимости от точки.
        Сообщения в один канал ставятся в очередь (пауза ~0.7 с, повтор при 429), чтобы реже терялись из‑за антиспама.
      </p>
    </header>

    ${flashHtml}

    <section class="card" style="margin-bottom:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Повторить отчёт о закрытии смены</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">
        Если алерт не пришёл — выбери смену и нажми «Отправить в Telegram».
        Уйдёт выручка/касса и учёт табака (если на точке включён и был подсчёт).
      </p>
      <form
        class="filters-bar"
        style="margin-bottom:1rem;"
        hx-get="/telegram/resend-shift"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >
        <select name="venueId">${venueFilterOptions(extras.venues, extras.venueId)}</select>
        <button type="submit" class="btn-secondary">Показать смены</button>
      </form>
      ${(extras.venues || []).length
        ? `
      <form
        class="filters-bar"
        style="margin-bottom:1rem;"
        hx-post="/telegram/resend-shift"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >
        <select name="venue_id" required>${venueFilterOptions(extras.venues, extras.venueId).replace('<option value="">Все заведения</option>', '<option value="">Заведение…</option>')}</select>
        <input type="hidden" name="latest" value="1" />
        <button type="submit">Последняя закрытая смена этой точки</button>
      </form>`
        : ''}
      <table class="data-table data-table-compact">
        <thead>
          <tr>
            <th>Смена</th>
            <th>Точка</th>
            <th>Закрыта</th>
            <th>Кассир</th>
            <th>Выручка</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${(extras.recentShifts || []).map(renderResendShiftRow).join('') ||
            '<tr><td colspan="6" class="empty-hint">Закрытых смен нет</td></tr>'}
        </tbody>
      </table>
    </section>

    <section class="card" style="margin-bottom:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Каналы по точкам</h2>
      <p class="muted" style="margin:0 0 .9rem;font-size:.9rem;">
        <strong>MC Lounge</strong> — Роза + Puff ·
        <strong>Kebab King</strong> — @imperialmckebabbot ·
        <strong>MC Гранд</strong> — @imperialMC_grand_bot
      </p>
      ${channelCards}
    </section>

    <section class="card" style="margin-bottom:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">MC Lounge — быстрые настройки</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">
        Форма ниже меняет только канал <code>mc_lounge</code> (Роза + Puff).
        Токены Kebab / Гранд задаются в БД (<code>telegram_channels</code>) или агентом при деплое — не светите их в git.
      </p>
      <ul style="margin:0 0 1rem;padding-left:1.1rem;line-height:1.6;">
        <li>Включено: <strong>${enabled ? 'да' : 'нет'}</strong></li>
        <li>Токен бота: ${tokenDisplay}</li>
        <li>Chat ID: <code>${chatDisplay}</code></li>
      </ul>
      <form
        class="stack-form"
        hx-post="/telegram/settings"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >
        <label style="display:flex;align-items:center;gap:.5rem;">
          <input type="checkbox" name="enabled" value="1" ${enabled ? 'checked' : ''} />
          Включить уведомления (MC Lounge)
        </label>
        <label>Токен бота Lounge (от @BotFather)
          <input type="password" name="bot_token" placeholder="${settings.hasToken ? 'оставьте пустым, чтобы не менять' : '123456:ABC...'}" autocomplete="off" />
        </label>
        <label>Chat ID группы Lounge
          <input type="text" name="chat_id" value="${settings.chatId ? escapeHtml(settings.chatId) : ''}" placeholder="-100xxxxxxxxxx" />
        </label>
        <button type="submit">Сохранить Lounge</button>
      </form>
    </section>

    <section class="card">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Проверка</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">
        Отправит тестовое сообщение <strong>во все настроенные каналы</strong> по очереди.
      </p>
      <form hx-post="/telegram/test" hx-target="#main-content" hx-swap="innerHTML">
        <button type="submit">Отправить тест во все каналы</button>
      </form>
    </section>

    <section class="card" style="margin-top:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Что приходит (в группу своей точки)</h2>
      <ul style="margin:0;padding-left:1.1rem;line-height:1.55;font-size:.92rem;">
        <li>Оплата наличными / чеки со скидкой</li>
        <li>Открытие / закрытие смены (выручка + касса)</li>
        <li>Внесение и инкассация</li>
        <li>Отмена пречека, удаление позиций, чек на 0 ₽</li>
        <li>Учёт табака: подсчёт смены, приход/списание тары, списание остатка (меласса)</li>
      </ul>
    </section>
  `;
}
