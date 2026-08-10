import { NativeModules, Platform } from 'react-native';

// Мост к нативному модулю AtolModule (Android только) — см.
// android/app/src/main/java/com/imperialmcterminal/atol/AtolModule.kt.
// Сам модуль ничего не хранит и не решает — просто передаёт готовое
// JSON-задание кассе (через приложение "Драйвер ККТ АТОЛ", установленное
// на этом же планшете) и возвращает её ответ как есть.
type AtolNativeModule = {
  runTask(settingsJson: string, taskJson: string): Promise<string>;
  isDriverAppInstalled(): Promise<boolean>;
};

const { AtolModule } = NativeModules as { AtolModule?: AtolNativeModule };

export type AtolConnectionSettings = {
  ipAddress: string;
  ipPort: number;
  model?: number | null;
};

export function isAtolAvailablePlatform(): boolean {
  if (Platform.OS !== 'android') return false;
  if (AtolModule == null) {
    // Модуль не зарегистрирован в текущей сборке — почти всегда значит, что
    // после добавления Kotlin-кода не делали полный `npx react-native
    // run-android` (одного Metro/JS-обновления недостаточно, нативный модуль
    // попадает в приложение только через пересборку и переустановку).
    return false;
  }
  return true;
}

// Проверка, установлено ли на этом планшете приложение "Драйвер ККТ АТОЛ" —
// используется на экране настроек, чтобы явно подсказать сотруднику, а не
// просто молча падать ошибками при первой продаже.
export async function isAtolDriverAppInstalled(): Promise<boolean> {
  if (!AtolModule) return false;
  try {
    return await AtolModule.isDriverAppInstalled();
  } catch {
    return false;
  }
}

export async function runAtolTask(settings: AtolConnectionSettings, task: unknown): Promise<unknown> {
  if (!AtolModule) {
    throw new Error('Драйвер АТОЛ недоступен на этом устройстве (не Android или модуль не собран)');
  }
  const responseText = await AtolModule.runTask(JSON.stringify(settings), JSON.stringify(task));
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}
