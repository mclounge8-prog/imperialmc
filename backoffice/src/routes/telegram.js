import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderTelegramSection } from '../views/telegramView.js';
import {
  readTelegramSettings,
  sendTelegramMessage,
  writeTelegramSettings,
  formatDateTime,
} from '../services/telegramNotify.js';

const routes = new Hono();
routes.use('*', requireAuthApi);

async function renderPage(flash = null) {
  const settings = await readTelegramSettings();
  return renderTelegramSection(settings, flash);
}

routes.post('/settings', async (c) => {
  const body = await c.req.parseBody();
  const enabled = body.enabled === '1' || body.enabled === 'on';
  const tokenInput = String(body.bot_token || '').trim();
  const chatId = String(body.chat_id || '').trim();

  const current = await readTelegramSettings();
  const botToken = tokenInput || current.botToken || null;

  await writeTelegramSettings({
    enabled,
    botToken,
    chatId: chatId || null,
  });

  return c.html(
    await renderPage({
      ok: true,
      text: 'Настройки Telegram сохранены',
    })
  );
});

routes.post('/test', async (c) => {
  try {
    const result = await sendTelegramMessage(
      `<b>Imperial MC — тест</b>\n🕒 ${formatDateTime()}\nЕсли вы это видите, бот настроен верно.`,
      { force: true }
    );
    if (result?.skipped) {
      return c.html(
        await renderPage({
          ok: false,
          text: 'Сначала сохраните токен бота и Chat ID',
        })
      );
    }
    return c.html(await renderPage({ ok: true, text: 'Тестовое сообщение отправлено' }));
  } catch (err) {
    return c.html(
      await renderPage({
        ok: false,
        text: err?.message || 'Не удалось отправить тест',
      })
    );
  }
});

export default routes;
export { renderPage as renderTelegramPage };
