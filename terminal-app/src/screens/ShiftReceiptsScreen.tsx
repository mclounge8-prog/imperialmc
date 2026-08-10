import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import { fetchShiftReceipts } from '../api/client';
import type { ShiftReceipt } from '../api/client';

const METHOD_LABELS: Record<string, string> = { cash: 'Наличные', card: 'Карта', other: 'Другое' };
const STATUS_LABELS: Record<string, string> = { paid: 'Оплачен', cancelled: 'Отменён' };

function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function ReceiptRow({ receipt }: { receipt: ShiftReceipt }) {
  const isPaid = receipt.status === 'paid';
  return (
    <View style={[styles.row, styles.rowBorder]}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {receipt.tableName ?? 'Быстрый заказ'} · {receipt.guestLabel ?? ''}
        </Text>
        <Text style={styles.rowSubtitle}>
          {formatTime(receipt.closedAt)}
          {receipt.staffName ? ` · ${receipt.staffName}` : ''}
          {isPaid && receipt.paymentMethods.length > 0
            ? ` · ${receipt.paymentMethods.map((m) => METHOD_LABELS[m] || m).join(', ')}`
            : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowTotal, !isPaid && styles.rowTotalCancelled]}>
          {formatMoney(receipt.total)}
        </Text>
        {!isPaid && <Text style={styles.statusLabel}>{STATUS_LABELS[receipt.status]}</Text>}
      </View>
    </View>
  );
}

export default function ShiftReceiptsScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;

  const [receipts, setReceipts] = useState<ShiftReceipt[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !venue) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShiftReceipts(venue.id, session.token);
      setReceipts(data.receipts);
      setHasOpenShift(data.shiftId !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить чеки');
    } finally {
      setLoading(false);
    }
  }, [session, venue]);

  useEffect(() => {
    load();
  }, [load]);

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
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasOpenShift) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Смена не открыта</Text>
        <Text style={styles.hint}>Откройте смену переключателем в «Настройках», чтобы увидеть её чеки.</Text>
      </View>
    );
  }

  const paidTotal = receipts.filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.total, 0);

  return (
    <View style={styles.container}>
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {receipts.length} чек{receipts.length === 1 ? '' : 'ов'} · {formatMoney(paidTotal)}
        </Text>
        <Pressable onPress={load}>
          <Text style={styles.summaryRefresh}>Обновить</Text>
        </Pressable>
      </View>
      {receipts.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.hint}>В этой смене пока нет чеков</Text>
        </View>
      ) : (
        <ScrollView>
          {receipts.map((r) => (
            <ReceiptRow key={r.id} receipt={r} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryText: { color: colors.textMuted, fontSize: 13 },
  summaryRefresh: { color: colors.accent2, fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLeft: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowTotal: { color: colors.accent2, fontSize: 14, fontWeight: '600' },
  rowTotalCancelled: { color: colors.textMuted, textDecorationLine: 'line-through' },
  statusLabel: { color: colors.danger, fontSize: 11, marginTop: 2 },
});
