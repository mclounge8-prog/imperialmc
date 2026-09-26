import { NativeModules, Platform } from 'react-native';

type KioskLockNative = {
  startLock(): Promise<boolean>;
  stopLock(): Promise<boolean>;
};

const { KioskLock } = NativeModules as { KioskLock?: KioskLockNative };

export async function startKioskLock(): Promise<void> {
  if (Platform.OS !== 'android' || !KioskLock) return;
  await KioskLock.startLock();
}

export async function stopKioskLock(): Promise<void> {
  if (Platform.OS !== 'android' || !KioskLock) return;
  await KioskLock.stopLock();
}
