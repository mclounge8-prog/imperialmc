import { NativeModules } from 'react-native';

let lastSoundAt = 0;

// На старом APK кухни метода нет — тогда новый заказ просто появляется в списке.
export function playNewKitchenOrderSound(): void {
  const now = Date.now();
  if (now - lastSoundAt < 1500) return;
  const play = NativeModules.UpdateModule?.playNewOrderSound;
  if (typeof play !== 'function') return;
  lastSoundAt = now;
  try {
    play();
  } catch {
    lastSoundAt = 0;
  }
}
