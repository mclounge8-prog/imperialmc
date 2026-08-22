import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const UPDATES_DIR = path.join(process.cwd(), 'public', 'updates');
export const MANIFEST_PATH = path.join(UPDATES_DIR, 'manifest.json');

const DEFAULT_MANIFEST = {
  apk: {
    versionCode: 1,
    versionName: '1.0.0',
    file: null,
    mandatory: false,
    notes: '',
  },
  js: {
    version: 0,
    minApkVersionCode: 1,
    file: null,
    mandatory: false,
    notes: '',
  },
};

export async function ensureUpdatesDir() {
  await fs.mkdir(UPDATES_DIR, { recursive: true });
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(DEFAULT_MANIFEST, null, 2)}\n`, 'utf8');
  }
}

export async function readManifest() {
  await ensureUpdatesDir();
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      apk: { ...DEFAULT_MANIFEST.apk, ...(parsed.apk || {}) },
      js: { ...DEFAULT_MANIFEST.js, ...(parsed.js || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_MANIFEST);
  }
}

export async function writeManifest(manifest) {
  await ensureUpdatesDir();
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function publicBaseUrl(c) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'imperial-mc.online';
  return `${proto}://${host}`;
}

export function manifestForClient(manifest, baseUrl) {
  const apkFile = manifest.apk?.file;
  const jsFile = manifest.js?.file;
  return {
    apk: {
      versionCode: Number(manifest.apk?.versionCode) || 1,
      versionName: String(manifest.apk?.versionName || '1.0.0'),
      url: apkFile ? `${baseUrl}/updates/${apkFile}` : null,
      mandatory: Boolean(manifest.apk?.mandatory),
      notes: String(manifest.apk?.notes || ''),
      sha256: manifest.apk?.sha256 || null,
    },
    js: {
      version: Number(manifest.js?.version) || 0,
      minApkVersionCode: Number(manifest.js?.minApkVersionCode) || 1,
      url: jsFile ? `${baseUrl}/updates/${jsFile}` : null,
      mandatory: Boolean(manifest.js?.mandatory),
      notes: String(manifest.js?.notes || ''),
      sha256: manifest.js?.sha256 || null,
    },
  };
}

export async function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function saveUpdateFile(filename, buffer) {
  await ensureUpdatesDir();
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(UPDATES_DIR, safe);
  await fs.writeFile(dest, buffer);
  return safe;
}
