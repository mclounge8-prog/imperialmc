import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderUpdatesSection } from '../views/updatesView.js';
import {
  manifestForClient,
  publicBaseUrl,
  readManifest,
  saveUpdateFile,
  sha256Buffer,
  writeManifest,
} from '../services/terminalUpdates.js';

const routes = new Hono();
routes.use('*', requireAuthApi);

async function renderPage(c) {
  const manifest = await readManifest();
  return renderUpdatesSection(manifest, manifestForClient(manifest, publicBaseUrl(c)));
}

routes.post('/apk', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const file = body.apk;
  if (!file || typeof file === 'string') {
    c.status(400);
    return c.html('<p>Выберите файл APK</p>');
  }

  const versionCode = Number(body.versionCode);
  const versionName = String(body.versionName || '').trim();
  if (!Number.isFinite(versionCode) || versionCode < 1 || !versionName) {
    c.status(400);
    return c.html('<p>Укажите корректные versionCode и versionName</p>');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const original = String(file.name || 'terminal.apk');
  const ext = original.toLowerCase().endsWith('.apk') ? '' : '.apk';
  const filename = `terminal-v${versionCode}-${Date.now()}${ext || '.apk'}`;
  const saved = await saveUpdateFile(filename, buffer);
  const digest = await sha256Buffer(buffer);

  const manifest = await readManifest();
  manifest.apk = {
    versionCode,
    versionName,
    file: saved,
    sha256: digest,
    mandatory: body.mandatory === '1' || body.mandatory === 'on',
    notes: String(body.notes || '').trim(),
  };
  await writeManifest(manifest);

  return c.html(await renderPage(c));
});

routes.post('/js', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const file = body.bundle;
  if (!file || typeof file === 'string') {
    c.status(400);
    return c.html('<p>Выберите ZIP с index.android.bundle</p>');
  }

  const version = Number(body.version);
  const minApkVersionCode = Number(body.minApkVersionCode) || 1;
  if (!Number.isFinite(version) || version < 1) {
    c.status(400);
    return c.html('<p>Укажите корректный JS version</p>');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `js-ota-v${version}-${Date.now()}.zip`;
  const saved = await saveUpdateFile(filename, buffer);
  const digest = await sha256Buffer(buffer);

  const manifest = await readManifest();
  manifest.js = {
    version,
    minApkVersionCode,
    file: saved,
    sha256: digest,
    mandatory: body.mandatory === '1' || body.mandatory === 'on',
    notes: String(body.notes || '').trim(),
  };
  await writeManifest(manifest);

  return c.html(await renderPage(c));
});

routes.post('/js/clear', async (c) => {
  const manifest = await readManifest();
  manifest.js = {
    version: 0,
    minApkVersionCode: Number(manifest.apk?.versionCode) || 1,
    file: null,
    sha256: null,
    mandatory: false,
    notes: '',
  };
  await writeManifest(manifest);
  return c.html(await renderPage(c));
});

export default routes;
export { renderPage as renderTerminalUpdatesPage };
