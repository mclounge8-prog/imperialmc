import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';
import { setDeviceKitchen } from '../api/client';

export default function KitchenEnableSwitch() {
  const { deviceToken, status, refresh } = useDevice();
  const enabled = Boolean(status?.kitchenEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    if (!deviceToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDeviceKitchen(deviceToken, next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переключить кухню');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <Text style={styles.title}>Кухня</Text>
      {busy ? (
        <ActivityIndicator color={colors.accent2} />
      ) : (
        <Switch
          value={enabled}
          onValueChange={(next) => void toggle(next)}
          disabled={!deviceToken}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={enabled ? colors.accent2 : '#d0d0d4'}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 44,
  },
  title: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  error: { color: colors.danger, fontSize: 12, maxWidth: 160 },
});
