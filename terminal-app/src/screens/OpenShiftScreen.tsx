import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useCurrentShift } from '../hooks/useCurrentShift';
import { openShift } from '../api/client';
import ShiftStatsCard from '../components/ShiftStatsCard';

export default function OpenShiftScreen() {
  const { session, venue, shift, setShift, loading, error, reload } = useCurrentShift();
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    if (!session || !venue) return;
    setOpening(true);
    try {
      const opened = await openShift(venue.id, session.token);
      setShift(opened);
    } catch (e) {
      Alert.alert('Не удалось открыть смену', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setOpening(false);
    }
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

  if (shift) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🟢 Смена уже открыта</Text>
        </View>
        <ShiftStatsCard shift={shift} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Смена не открыта</Text>
      <Text style={styles.hint}>
        Откройте смену перед началом продаж — все чеки будут привязаны к ней и попадут в X-отчёт.
      </Text>
      <Pressable style={styles.openButton} disabled={opening} onPress={handleOpen}>
        {opening ? (
          <ActivityIndicator color="#f1f1f3" />
        ) : (
          <Text style={styles.openButtonText}>Открыть смену</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
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
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  openButton: {
    backgroundColor: colors.accent2,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    minWidth: 200,
    alignItems: 'center',
  },
  openButtonText: { color: '#f1f1f3', fontSize: 15, fontWeight: '700' },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent2,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  badgeText: { color: colors.accent2, fontSize: 13, fontWeight: '600' },
});
