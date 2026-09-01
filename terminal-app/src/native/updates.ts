import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type AppVersionInfo = {
  versionCode: number;
  versionName: string;
  jsOtaVersion: number;
  hasJsOta: boolean;
};

type UpdateNativeModule = {
  getAppVersion(): Promise<AppVersionInfo>;
  canRequestPackageInstalls(): Promise<boolean>;
  openUnknownSourcesSettings(): Promise<void>;
  downloadFile(url: string, fileName: string): Promise<string>;
  installApk(apkPath: string): Promise<void>;
  applyJsBundleZip(zipPath: string, jsVersion: number): Promise<string>;
  applyJsBundleZipAndRestart?(zipPath: string, jsVersion: number): Promise<void>;
  clearJsOta(): Promise<void>;
  restartApp(): Promise<void>;
};

const { UpdateModule } = NativeModules as { UpdateModule?: UpdateNativeModule };

export function isUpdatesAvailable(): boolean {
  return Platform.OS === 'android' && UpdateModule != null;
}

export async function getAppVersion(): Promise<AppVersionInfo> {
  if (!UpdateModule) {
    return { versionCode: 0, versionName: '0', jsOtaVersion: 0, hasJsOta: false };
  }
  return UpdateModule.getAppVersion();
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  if (!UpdateModule) return false;
  return UpdateModule.canRequestPackageInstalls();
}

export async function openUnknownSourcesSettings(): Promise<void> {
  if (!UpdateModule) return;
  await UpdateModule.openUnknownSourcesSettings();
}

export async function downloadUpdateFile(url: string, fileName: string): Promise<string> {
  if (!UpdateModule) throw new Error('UpdateModule недоступен');
  return UpdateModule.downloadFile(url, fileName);
}

export async function installApk(apkPath: string): Promise<void> {
  if (!UpdateModule) throw new Error('UpdateModule недоступен');
  await UpdateModule.installApk(apkPath);
}

export async function applyJsBundleZip(zipPath: string, jsVersion: number): Promise<string> {
  if (!UpdateModule) throw new Error('UpdateModule недоступен');
  return UpdateModule.applyJsBundleZip(zipPath, jsVersion);
}

/** Предпочтительно: commit + рестарт на native, без гонки со старым JS. */
export async function applyJsBundleZipAndRestart(
  zipPath: string,
  jsVersion: number
): Promise<void> {
  if (!UpdateModule) throw new Error('UpdateModule недоступен');
  if (typeof UpdateModule.applyJsBundleZipAndRestart === 'function') {
    await UpdateModule.applyJsBundleZipAndRestart(zipPath, jsVersion);
    return;
  }
  await UpdateModule.applyJsBundleZip(zipPath, jsVersion);
  await new Promise((r) => setTimeout(r, 300));
  const local = await UpdateModule.getAppVersion();
  if (Number(local.jsOtaVersion) < Number(jsVersion)) {
    throw new Error('OTA не сохранилась на устройстве — поставьте APK обновление');
  }
  await UpdateModule.restartApp();
}

export async function clearJsOta(): Promise<void> {
  if (!UpdateModule) return;
  await UpdateModule.clearJsOta();
}

export async function restartApp(): Promise<void> {
  if (!UpdateModule) return;
  await UpdateModule.restartApp();
}

export type DownloadProgressEvent = { id: string; progress: number };

export function subscribeDownloadProgress(
  listener: (event: DownloadProgressEvent) => void
): () => void {
  if (!UpdateModule) return () => undefined;
  const emitter = new NativeEventEmitter(UpdateModule as never);
  const sub = emitter.addListener('UpdateDownloadProgress', listener);
  return () => sub.remove();
}
