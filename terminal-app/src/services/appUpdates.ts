import { API_BASE_URL } from '../api/client';
import {
  applyJsBundleZipAndRestart,
  canRequestPackageInstalls,
  downloadUpdateFile,
  getAppVersion,
  installApk,
  isUpdatesAvailable,
  openUnknownSourcesSettings,
} from '../native/updates';
import { chooseUpdatePlan } from './updatePlan';
import type { RemoteUpdatesManifest, UpdateChannel, UpdatePlan } from './updatePlan';

export type {
  RemoteApkInfo,
  RemoteUpdatesManifest,
  UpdateChannel,
  UpdatePlan,
} from './updatePlan';

export async function fetchUpdatesManifest(): Promise<RemoteUpdatesManifest> {
  const response = await fetch(`${API_BASE_URL}/api/terminal/updates`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Не удалось проверить обновления (HTTP ${response.status})`);
  }
  return response.json();
}

export async function planUpdate(channel: UpdateChannel = 'staff'): Promise<UpdatePlan> {
  if (!isUpdatesAvailable()) return { kind: 'none' };
  const [local, remote] = await Promise.all([getAppVersion(), fetchUpdatesManifest()]);
  return chooseUpdatePlan(channel, local, remote);
}

export async function applyApkUpdate(plan: Extract<UpdatePlan, { kind: 'apk' }>): Promise<void> {
  if (!plan.remote.url) throw new Error('Нет URL APK');

  const allowed = await canRequestPackageInstalls();
  if (!allowed) {
    await openUnknownSourcesSettings();
    throw new Error('NEED_INSTALL_PERMISSION');
  }

  const path = await downloadUpdateFile(
    plan.remote.url,
    `terminal-v${plan.remote.versionCode}.apk`
  );
  await installApk(path);
}

export async function applyJsUpdate(plan: Extract<UpdatePlan, { kind: 'js' }>): Promise<void> {
  if (!plan.remote.url) throw new Error('Нет URL JS OTA');
  const path = await downloadUpdateFile(plan.remote.url, `js-ota-v${plan.remote.version}.zip`);
  // Native сам делает commit prefs и Runtime.exit — без гонки со старым JS-бандлом.
  await applyJsBundleZipAndRestart(path, plan.remote.version);
}
