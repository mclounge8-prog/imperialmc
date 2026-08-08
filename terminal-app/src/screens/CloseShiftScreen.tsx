import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useCurrentShift } from '../hooks/useCurrentShift';
import { closeShift } from '../api/client';
import type { Shift } from '../api/client';
import ShiftStatsCard from '../components/ShiftStatsCard';

export default function CloseShiftScreen() {
  const { session, venue, shift, setShift, loading, error, reload } = useCurrentShift();
  const [closing, setClosing] = useState(false);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);

  const doClose = async () => {
    if (!session || !venue) return;
    setClosing(true);
    try {
      const result = await closeShift(venue.id, session.token);
      setClosedShift(result);
      setShift(null);
    } catch (e) {
      Alert.alert('Не удалось закрыть смену', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setClosing(false);
    }
  };

  const handleClosePress = () => {
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
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={reload}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  if (closedShift) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.badgeDone}>
          <Text style={styles.badgeDoneText}>✅ Смена закрыта</Text>
        </View>
        <ShiftStatsCard shift={closedShift} />
      </ScrollView>
    );
  }

  if (!shift) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Нет открытой смены</Text>
        <Text style={styles.hint}>Сначала откройте смену в разделе «Открытие смены».</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ShiftStatsCard shift={shift} />
      <Pressable style={styles.closeButton} disabled={closing} onPress={handleClosePress}>
        {closing ? (
          <ActivityIndicator color="#f1f1f3" />
        ) : (
          <Text style={styles.closeButtonText}>Закрыть смену</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 8, textAlign: 'center' },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryText: { color: colors.text, fontSize: 14 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  closeButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  closeButtonText: { color: '#f1f1f3', fontSize: 15, fontWeight: '700' },
  badgeDone: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent2,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  badgeDoneText: { color: colors.accent2, fontSize: 13, fontWeight: '600' },
});
