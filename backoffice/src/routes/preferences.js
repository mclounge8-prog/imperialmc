import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { writeSelectedVenueId, readLastSection } from '../utils/preferences.js';
import { renderFragmentHtml } from './dashboard.js';

const preferences = new Hono();
preferences.use('*', requireAuthApi);

// Общий переключатель заведения в шапке (склад/меню/столы читают этот же
// выбор) — при смене сразу перерисовывает ТЕКУЩИЙ раздел с новым заведением,
// не заставляя каждый раз выбирать его заново в каждом разделе отдельно.
preferences.post('/venue', async (c) => {
  const body = await c.req.parseBody();
  const venueId = body.venue_id ? Number(body.venue_id) : null;
  if (venueId) {
    writeSelectedVenueId(c, venueId);
  }

  const section = readLastSection(c) || 'dashboard';
  const html = await renderFragmentHtml(section, c);
  return c.html(html || '');
});

export default preferences;
