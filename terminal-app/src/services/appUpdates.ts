import { API_BASE_URL } from '../api/client';
import {
  applyJsBundleZip,
  canRequestPackageInstalls,
  downloadUpdateFile,
  getAppVersion,
  installApk,
  isUpdatesAvailable,
  openUnknownSourcesSettings,
  restartApp,
} from '../native/updates';

export type RemoteUpdatesManifest = {
  apk: {
    versionCode: number;
    versionName: string;
    url: string | null;
    mandatory: boolean;
    notes: string;
    sha256: string | null;
  };
  js: {
    version: number;
    minApkVersionCode: number;
    url: string | null;
    mandatory: boolean;
    notes: string;
    sha256: string | null;
  };
};

export type UpdatePlan =
  | { kind: 'none' }
  | {
      kind: 'apk';
      remote: RemoteUpdatesManifest['apk'];
      localVersionCode: number;
      localVersionName: string;
    }
  | {
      kind: 'js';
      remote: RemoteUpdatesManifest['js'];
      localJsVersion: number;
      localVersionCode: number;
    };

export async function fetchUpdatesManifest(): Promise<RemoteUpdatesManifest> {
  const response = await fetch(`${API_BASE_URL}/api/terminal/updates`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Не удалось проверить обновления (HTTP ${response.status})`);
  }
  return response.json();
}

export async function planUpdate(): Promise<UpdatePlan> {
  if (!isUpdatesAvailable()) return { kind: 'none' };

  const [local, remote] = await Promise.all([getAppVersion(), fetchUpdatesManifest()]);

  if (
    remote.apk.url &&
    Number(remote.apk.versionCode) > Number(local.versionCode)
  ) {
    return {
      kind: 'apk',
      remote: remote.apk,
      localVersionCode: local.versionCode,
      localVersionName: local.versionName,
    };
  }

  if (
    remote.js.url &&
    Number(remote.js.version) > Number(local.jsOtaVersion) &&
    Number(local.versionCode) >= Number(remote.js.minApkVersionCode)
  ) {
    return {
      kind: 'js',
      remote: remote.js,
      localJsVersion: local.jsOtaVersion,
      localVersionCode: local.versionCode,
    };
  }

  return { kind: 'none' };
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
  await applyJsBundleZip(path, plan.remote.version);
  // Короткая пауза после commit prefs на native-стороне, затем жёсткий рестарт.
  await new Promise((r) => setTimeout(r, 250));
  const local = await getAppVersion();
  if (Number(local.jsOtaVersion) < Number(plan.remote.version)) {
    throw new Error('OTA не сохранилась на устройстве — попробуйте ещё раз или поставьте APK');
  }
  await restartApp();
}
