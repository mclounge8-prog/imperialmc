import { DeviceEventEmitter } from 'react-native';

export const CHECK_UPDATES_EVENT = 'imperial-mc:check-updates';

export function requestUpdateCheck() {
  DeviceEventEmitter.emit(CHECK_UPDATES_EVENT);
}
