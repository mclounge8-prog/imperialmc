import { Hono } from 'hono';
import { manifestForClient, publicBaseUrl, readManifest } from '../services/terminalUpdates.js';

const api = new Hono();

// Публичный манифест для планшетов — без авторизации.
api.get('/terminal/updates', async (c) => {
  const manifest = await readManifest();
  return c.json(manifestForClient(manifest, publicBaseUrl(c)));
});

export default api;
