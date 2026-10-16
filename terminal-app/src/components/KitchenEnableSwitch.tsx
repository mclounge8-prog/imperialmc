import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';
import { setDeviceKitchen } from '../api/client';

type Props = {
  variant?: 'button' | 'row';
};

export default function KitchenEnableSwitch({ variant = 'row' }: Props) {
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

  if (variant === 'button') {
    return (
      <View style={styles.buttonWrap}>
        <Pressable
          style={[styles.button, enabled && styles.buttonOn]}
          disabled={busy || !deviceToken}
          onPress={() => void toggle(!enabled)}
        >
          {busy ? (
            <ActivityIndicator color={enabled ? '#f1f1f3' : colors.accent2} />
          ) : (
            <Text style={[styles.buttonText, enabled && styles.buttonTextOn]}>
              {enabled ? 'Кухня включена' : 'Включить кухню'}
            </Text>
          )}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.icon}>🍳</Text>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Кухня</Text>
          <Text style={styles.subtitle}>
            {enabled
              ? 'Планшет кухни видит заказы этой смены'
              : 'Выключено — заказы на кухню не уходят'}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonWrap: { width: '100%', paddingHorizontal: 16, marginTop: 10 },
  button: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent2,
    backgroundColor: colors.surface,
  },
  buttonOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent2,
  },
  buttonText: { color: colors.accent2, fontSize: 16, fontWeight: '700' },
  buttonTextOn: { color: '#f1f1f3' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  icon: { fontSize: 20 },
  textBlock: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger, fontSize: 12, marginTop: 6 },
});
