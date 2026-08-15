import { escapeHtml } from './escapeHtml.js';

export function renderTelegramSection(settings, flash = null) {
  const enabled = !!settings.enabled;
  const tokenDisplay = settings.hasToken ? '•••••••• (задан)' : 'не задан';
  const chatDisplay = settings.chatId ? escapeHtml(settings.chatId) : 'не задан';
  const flashHtml = flash
    ? `<p class="${flash.ok ? 'hint' : 'field-error'}" style="margin-bottom:1rem;">${escapeHtml(flash.text)}</p>`
    : '';

  return `
    <header>
      <h1>Telegram</h1>
      <p>Уведомления о кассовых событиях в чат/группу: оплаты наличными, смены, инкассации, отмены пречеков и др.</p>
    </header>

    ${flashHtml}

    <section class="card" style="margin-bottom:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Статус</h2>
      <ul style="margin:0;padding-left:1.1rem;line-height:1.6;">
        <li>Включено: <strong>${enabled ? 'да' : 'нет'}</strong></li>
        <li>Токен бота: ${tokenDisplay}</li>
        <li>Chat ID: <code>${chatDisplay}</code></li>
      </ul>
      <p class="muted" style="margin:.75rem 0 0;font-size:.85rem;">
        Создайте бота у <code>@BotFather</code>, добавьте его в группу и узнайте chat_id
        (например через <code>@userinfobot</code> или getUpdates). Подробности — в сообщении агента / README.
      </p>
    </section>

    <section class="card" style="margin-bottom:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Настройки</h2>
      <form
        class="stack-form"
        hx-post="/telegram/settings"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >
        <label style="display:flex;align-items:center;gap:.5rem;">
          <input type="checkbox" name="enabled" value="1" ${enabled ? 'checked' : ''} />
          Включить уведомления
        </label>
        <label>Токен бота (от @BotFather)
          <input type="password" name="bot_token" placeholder="${settings.hasToken ? 'оставьте пустым, чтобы не менять' : '123456:ABC...'}" autocomplete="off" />
        </label>
        <label>Chat ID (личный чат или группа)
          <input type="text" name="chat_id" value="${settings.chatId ? escapeHtml(settings.chatId) : ''}" placeholder="-100xxxxxxxxxx" />
        </label>
        <button type="submit">Сохранить</button>
      </form>
    </section>

    <section class="card">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Проверка</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">Отправит тестовое сообщение в указанный чат.</p>
      <form hx-post="/telegram/test" hx-target="#main-content" hx-swap="innerHTML">
        <button type="submit">Отправить тест</button>
      </form>
    </section>

    <section class="card" style="margin-top:1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Что приходит</h2>
      <ul style="margin:0;padding-left:1.1rem;line-height:1.55;font-size:.92rem;">
        <li>Оплата наличными</li>
        <li>Открытие / закрытие смены</li>
        <li>Внесение и инкассация</li>
        <li>Отмена пречека (с комментарием)</li>
        <li>Удаление позиций из чека</li>
        <li>Закрытие чека на 0 ₽</li>
      </ul>
    </section>
  `;
}
