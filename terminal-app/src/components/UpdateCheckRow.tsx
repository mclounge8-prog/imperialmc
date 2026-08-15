import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { getAppVersion, isUpdatesAvailable } from '../native/updates';
import { planUpdate } from '../services/appUpdates';
import { requestUpdateCheck } from '../services/updateEvents';

export default function UpdateCheckRow() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState<string>('');

  React.useEffect(() => {
    if (!isUpdatesAvailable()) {
      setVersionLabel('Обновления недоступны в этой сборке');
      return;
    }
    void getAppVersion().then((v) => {
      setVersionLabel(
        `APK ${v.versionName} (${v.versionCode})${v.jsOtaVersion ? ` · JS OTA ${v.jsOtaVersion}` : ''}`
      );
    });
  }, [status]);

  const onCheck = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const plan = await planUpdate();
      if (plan.kind === 'none') {
        setStatus('Установлена актуальная версия');
      } else {
        setStatus(plan.kind === 'apk' ? 'Найдено обновление APK' : 'Найдено обновление JS');
        requestUpdateCheck();
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Ошибка проверки');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable style={styles.row} onPress={() => void onCheck()} disabled={busy}>
        <Text style={styles.rowIcon}>⬆️</Text>
        <View style={styles.rowTextBlock}>
          <Text style={styles.rowTitle}>Обновления</Text>
          <Text style={styles.rowSubtitle}>
            {busy ? 'Проверка…' : status || versionLabel || 'Проверить обновления с сервера'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.accent2} />
        ) : (
          <Text style={styles.rowChevron}>›</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowIcon: { fontSize: 20 },
  rowTextBlock: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowChevron: { color: colors.textMuted, fontSize: 20 },
});
