import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useCurrentShift } from '../hooks/useCurrentShift';
import { openShift, closeShift } from '../api/client';

function formatTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Ползунок статуса смены: влево — закрыта, вправо — открыта. Одновременно и
// индикатор, и быстрое управление — тащить вправо открывает смену, влево
// (с подтверждением) закрывает, без похода в отдельные экраны.
export default function ShiftToggle() {
  const { session, venue, shift, setShift, loading, error, reload } = useCurrentShift();
  const [toggling, setToggling] = useState(false);
  const isOpen = Boolean(shift);

  const doOpen = async () => {
    if (!session || !venue) return;
    setToggling(true);
    try {
      const opened = await openShift(venue.id, session.token);
      setShift(opened);
    } catch (e) {
      Alert.alert('Не удалось открыть смену', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setToggling(false);
    }
  };

  const doClose = async () => {
    if (!session || !venue) return;
    setToggling(true);
    try {
      await closeShift(venue.id, session.token);
      setShift(null);
    } catch (e) {
      Alert.alert('Не удалось закрыть смену', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setToggling(false);
    }
  };

  const handleToggle = (next: boolean) => {
    if (toggling) return;
    if (next) {
      doOpen();
      return;
    }
    Alert.alert(
      'Закрыть смену?',
      'После закрытия новые чеки будут относиться к следующей смене. Это действие нельзя отменить.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Закрыть смену', style: 'destructive', onPress: doClose },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.card, styles.center]}>
        <ActivityIndicator color={colors.accent2} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.retryLink} onPress={reload}>
          Повторить
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Смена {isOpen ? 'открыта' : 'закрыта'}</Text>
          <Text style={styles.subtitle}>
            {isOpen
              ? `с ${formatTime(shift?.openedAt ?? null)}${shift?.openedByName ? ` · ${shift.openedByName}` : ''}`
              : 'Сдвиньте, чтобы начать смену'}
          </Text>
        </View>
        {toggling ? (
          <ActivityIndicator color={colors.accent2} />
        ) : (
          <Switch
            value={isOpen}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: colors.accent2 }}
            thumbColor="#f1f1f3"
            ios_backgroundColor={colors.border}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  textBlock: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  errorText: { color: colors.danger, fontSize: 13 },
  retryLink: { color: colors.accent2, fontSize: 13, fontWeight: '600', marginTop: 8 },
});
