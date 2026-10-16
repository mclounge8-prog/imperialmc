export type RemoteApkInfo = {
  versionCode: number;
  versionName: string;
  url: string | null;
  mandatory: boolean;
  notes: string;
  sha256: string | null;
};

export type RemoteJsInfo = {
  version: number;
  minApkVersionCode: number;
  url: string | null;
  mandatory: boolean;
  notes: string;
  sha256: string | null;
};

export type RemoteUpdatesManifest = {
  apk: RemoteApkInfo;
  js: RemoteJsInfo;
  kiosk?: {
    versionCode: number;
    versionName: string;
    url: string | null;
    notes: string;
    sha256: string | null;
  };
  kitchen?: {
    versionCode: number;
    versionName: string;
    url: string | null;
    mandatory?: boolean;
    notes: string;
    sha256: string | null;
  };
  kitchenJs?: RemoteJsInfo;
};

export type UpdatePlan =
  | { kind: 'none' }
  | {
      kind: 'apk';
      remote: RemoteApkInfo;
      localVersionCode: number;
      localVersionName: string;
    }
  | {
      kind: 'js';
      remote: RemoteJsInfo;
      localJsVersion: number;
      localVersionCode: number;
    };

export type UpdateChannel = 'staff' | 'kiosk' | 'kitchen';

type LocalVersion = {
  versionCode: number;
  versionName: string;
  jsOtaVersion: number;
};

function apkPlan(remote: RemoteApkInfo, local: LocalVersion): UpdatePlan {
  return {
    kind: 'apk',
    remote,
    localVersionCode: local.versionCode,
    localVersionName: local.versionName,
  };
}

function jsPlan(remote: RemoteJsInfo, local: LocalVersion): UpdatePlan {
  return {
    kind: 'js',
    remote,
    localJsVersion: local.jsOtaVersion,
    localVersionCode: local.versionCode,
  };
}

export function chooseUpdatePlan(
  channel: UpdateChannel,
  local: LocalVersion,
  remote: RemoteUpdatesManifest
): UpdatePlan {
  if (channel === 'kiosk') {
    const kiosk = remote.kiosk;
    if (kiosk?.url && Number(kiosk.versionCode) > Number(local.versionCode)) {
      return apkPlan(
        {
          versionCode: Number(kiosk.versionCode),
          versionName: String(kiosk.versionName || ''),
          url: kiosk.url,
          mandatory: false,
          notes: String(kiosk.notes || ''),
          sha256: kiosk.sha256 || null,
        },
        local
      );
    }
    return { kind: 'none' };
  }

  if (channel === 'kitchen') {
    const kitchen = remote.kitchen;
    if (kitchen?.url && Number(kitchen.versionCode) > Number(local.versionCode)) {
      return apkPlan(
        {
          versionCode: Number(kitchen.versionCode),
          versionName: String(kitchen.versionName || ''),
          url: kitchen.url,
          mandatory: kitchen.mandatory !== false,
          notes: String(kitchen.notes || ''),
          sha256: kitchen.sha256 || null,
        },
        local
      );
    }
    const js = remote.kitchenJs;
    if (
      js?.url &&
      Number(js.version) > Number(local.jsOtaVersion) &&
      Number(local.versionCode) >= Number(js.minApkVersionCode)
    ) {
      return jsPlan(js, local);
    }
    return { kind: 'none' };
  }

  if (remote.apk.url && Number(remote.apk.versionCode) > Number(local.versionCode)) {
    return apkPlan(remote.apk, local);
  }

  if (
    remote.js.url &&
    Number(remote.js.version) > Number(local.jsOtaVersion) &&
    Number(local.versionCode) >= Number(remote.js.minApkVersionCode)
  ) {
    return jsPlan(remote.js, local);
  }

  return { kind: 'none' };
}
