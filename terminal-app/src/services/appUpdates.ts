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

export type RemoteApkInfo = {
  versionCode: number;
  versionName: string;
  url: string | null;
  mandatory: boolean;
  notes: string;
  sha256: string | null;
};

export type RemoteUpdatesManifest = {
  apk: RemoteApkInfo;
  js: {
    version: number;
    minApkVersionCode: number;
    url: string | null;
    mandatory: boolean;
    notes: string;
    sha256: string | null;
  };
  kiosk?: {
    versionCode: number;
    versionName: string;
    url: string | null;
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

export async function planUpdate(channel: 'staff' | 'kiosk' = 'staff'): Promise<UpdatePlan> {
  if (!isUpdatesAvailable()) return { kind: 'none' };

  const [local, remote] = await Promise.all([getAppVersion(), fetchUpdatesManifest()]);

  if (channel === 'kiosk') {
    const kiosk = remote.kiosk;
    if (kiosk?.url && Number(kiosk.versionCode) > Number(local.versionCode)) {
      return {
        kind: 'apk',
        remote: {
          versionCode: Number(kiosk.versionCode),
          versionName: String(kiosk.versionName || ''),
          url: kiosk.url,
          mandatory: false,
          notes: String(kiosk.notes || ''),
          sha256: kiosk.sha256 || null,
        },
        localVersionCode: local.versionCode,
        localVersionName: local.versionName,
      };
    }
    return { kind: 'none' };
  }

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
  // Native сам делает commit prefs и Runtime.exit — без гонки со старым JS-бандлом.
  await applyJsBundleZipAndRestart(path, plan.remote.version);
}
