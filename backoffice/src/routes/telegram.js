import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderTelegramSection } from '../views/telegramView.js';
import { fetchAllVenues } from '../utils/venues.js';
import {
  listRecentClosedShifts,
  sendClosedShiftTelegramAlerts,
} from '../services/shiftCloseTelegram.js';
import {
  listTelegramChannels,
  listTelegramChannelsWithVenues,
  readTelegramSettings,
  sendTelegramMessage,
  writeTelegramSettings,
  formatDateTime,
} from '../services/telegramNotify.js';

const routes = new Hono();
routes.use('*', requireAuthApi);

function parseVenueId(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function loadTelegramPageData(venueId = null) {
  const [settings, channels, venues, recentShifts] = await Promise.all([
    readTelegramSettings(),
    listTelegramChannelsWithVenues(),
    fetchAllVenues(),
    listRecentClosedShifts({ venueId, limit: 25 }),
  ]);
  return { settings, channels, venues, recentShifts, venueId };
}

async function renderPage(flash = null, venueId = null) {
  const data = await loadTelegramPageData(venueId);
  return renderTelegramSection(data.settings, flash, data.channels, {
    venues: data.venues,
    recentShifts: data.recentShifts,
    venueId: data.venueId,
  });
}

function escapeFlash(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resendFlashHtml({ ok, text }) {
  return `<p class="${ok ? 'hint' : 'field-error'}" style="margin:0;">${escapeFlash(text)}</p>`;
}

async function handleResend(c) {
  const isPost = c.req.method === 'POST';
  const body = isPost ? await c.req.parseBody().catch(() => ({})) : {};
  const queryVenueId = parseVenueId(c.req.query('venueId') || c.req.query('venue_id'));
  const bodyVenueId = parseVenueId(body.venue_id || body.venueId);
  const filterVenueId = bodyVenueId || queryVenueId;
  const snippet = c.req.query('snippet') === '1' || body.snippet === '1';

  if (!isPost) {
    return c.html(await renderPage(null, queryVenueId));
  }

  try {
    let shiftId = Number(body.shift_id || body.shiftId || c.req.query('shift_id') || 0);
    if ((!shiftId || !Number.isFinite(shiftId)) && (body.latest === '1' || c.req.query('latest') === '1')) {
      if (!filterVenueId) {
        const msg = 'Выбери заведение, чтобы отправить последнюю закрытую смену';
        if (snippet) return c.html(resendFlashHtml({ ok: false, text: msg }));
        return c.html(await renderPage({ ok: false, text: msg }, filterVenueId));
      }
      const recent = await listRecentClosedShifts({ venueId: filterVenueId, limit: 1 });
      if (!recent.length) {
        const msg = 'У этой точки нет закрытых смен';
        if (snippet) return c.html(resendFlashHtml({ ok: false, text: msg }));
        return c.html(await renderPage({ ok: false, text: msg }, filterVenueId));
      }
      shiftId = recent[0].id;
    }

    if (!shiftId || !Number.isFinite(shiftId)) {
      const msg = 'Не указана смена';
      if (snippet) return c.html(resendFlashHtml({ ok: false, text: msg }));
      return c.html(await renderPage({ ok: false, text: msg }, filterVenueId));
    }

    const result = await sendClosedShiftTelegramAlerts({
      shiftId,
      force: true,
      resent: true,
    });
    const extra = result.sentTobacco ? ' + учёт табака' : '';
    const text = `Отправлено: ${result.venueName} · смена #${result.shiftId}${extra}`;
    if (snippet) return c.html(resendFlashHtml({ ok: true, text }));
    return c.html(await renderPage({ ok: true, text }, filterVenueId || result.shift?.venueId));
  } catch (err) {
    const text = err?.message || 'Не удалось отправить отчёт';
    if (snippet) return c.html(resendFlashHtml({ ok: false, text }));
    return c.html(await renderPage({ ok: false, text }, filterVenueId));
  }
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

routes.get('/resend-shift', handleResend);
routes.post('/resend-shift', handleResend);

export default routes;
export { renderPage as renderTelegramPage };
