import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderTelegramSection } from '../views/telegramView.js';
import {
  listTelegramChannels,
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
    const { listTelegramChannels } = await import('../services/telegramNotify.js');
    const channels = await listTelegramChannels();
    const results = [];
    for (const ch of channels) {
      if (!ch.botToken || !ch.chatId) {
        results.push(`${ch.name}: не настроен`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await sendTelegramMessage(
        `<b>Imperial MC — тест</b>\nКанал: ${ch.name}\n🕒 ${formatDateTime()}\nЕсли вы это видите, бот настроен верно.`,
        { force: true, channelKey: ch.key }
      );
      results.push(
        result?.skipped
          ? `${ch.name}: пропуск (${result.reason || 'disabled'})`
          : `${ch.name}: ок`
      );
    }
    if (!results.length) {
      return c.html(
        await renderPage({
          ok: false,
          text: 'Сначала сохраните токен бота и Chat ID',
        })
      );
    }
    return c.html(await renderPage({ ok: true, text: results.join('; ') }));
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
