import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useCurrentShift } from '../hooks/useCurrentShift';
import ShiftStatsCard from '../components/ShiftStatsCard';

// X-отчёт — сводка по текущей смене без её закрытия (в отличие от Z-отчёта,
// который в реальных фискальных кассах закрывает смену). Пока просто читает
// те же живые цифры, что и «Закрытие смены», но без кнопки закрытия.
export default function XReportScreen() {
  const { shift, loading, error, reload } = useCurrentShift();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
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

  if (!shift) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Смена не открыта</Text>
        <Text style={styles.hint}>Откройте смену в разделе «Открытие смены», чтобы увидеть отчёт.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ShiftStatsCard shift={shift} />
      <Pressable style={styles.refreshButton} disabled={refreshing} onPress={handleRefresh}>
        {refreshing ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.refreshButtonText}>Обновить</Text>
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
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  refreshButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
