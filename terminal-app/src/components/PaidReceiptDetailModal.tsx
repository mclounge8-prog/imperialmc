import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { fetchPaidReceiptDetail, refundPaidReceipt, printPaidReceiptCopy } from '../api/client';
import type { PaidReceiptDetail } from '../api/client';
import { runPendingFiscalJobs } from '../services/fiscalWorker';
import { formatVenueDateTime } from '../utils/timezone';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Безнал',
  other: 'Другое',
};

function formatMoney(value: number): string {
  return `${value.toFixed(0)} ₽`;
}

function formatDateTime(value: string): string {
  return formatVenueDateTime(value);
}

type Props = {
  receiptId: number | null;
  token: string;
  venueId?: number | null;
  onClose: () => void;
  onRefunded?: () => void;
};

export default function PaidReceiptDetailModal({
  receiptId,
  token,
  venueId,
  onClose,
  onRefunded,
}: Props) {
  const [detail, setDetail] = useState<PaidReceiptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (receiptId === null) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchPaidReceiptDetail(receiptId, token)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить чек'))
      .finally(() => setLoading(false));
  }, [receiptId, token]);

  const confirmRefund = () => {
    if (!detail || detail.status !== 'paid') return;
    const methods = (detail.payments || [])
      .map((p) => `${METHOD_LABELS[p.method] || p.method} ${formatMoney(p.amount)}`)
      .join(', ');
    const cardHint = (detail.payments || []).some((p) => p.method === 'card')
      ? '\n\nБезнал: возврат на банковском терминале сделайте отдельно.'
      : '';
    Alert.alert(
      'Вернуть чек?',
      `Сумма ${formatMoney(detail.total)}${methods ? `\n${methods}` : ''}.${cardHint}`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Вернуть',
          style: 'destructive',
          onPress: () => {
            void doRefund();
          },
        },
      ]
    );
  };

  const doPrintCopy = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await printPaidReceiptCopy(detail.id, token);
      if (venueId) {
        runPendingFiscalJobs(venueId, token);
      }
      Alert.alert('Печать', 'Копия чека отправлена на кассу');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось напечатать копию');
    } finally {
      setBusy(false);
    }
  };

  const doRefund = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await refundPaidReceipt(detail.id, token);
      setDetail(updated);
      if (venueId) {
        runPendingFiscalJobs(venueId, token);
      }
      onRefunded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось оформить возврат');
    } finally {
      setBusy(false);
    }
  };

  const isRefunded = detail?.status === 'refunded';
  const canRefund = detail?.status === 'paid' && !busy;
  const canPrintCopy =
    detail != null && (detail.status === 'paid' || detail.status === 'refunded') && !busy;

  return (
    <Modal visible={receiptId !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent2} size="large" />
            </View>
          ) : error && !detail ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : detail ? (
            <>
              <Text style={styles.title} numberOfLines={1}>
                {detail.tableName ?? 'Быстрый заказ'}
                {detail.guestLabel ? ` · ${detail.guestLabel}` : ''}
              </Text>
              <Text style={styles.subtitle}>
                {formatDateTime(detail.closedAt)}
                {detail.staffName ? ` · ${detail.staffName}` : ''}
              </Text>
              {isRefunded ? (
                <Text style={styles.refundedBadge}>
                  Возвращён
                  {detail.refundedAt ? ` · ${formatDateTime(detail.refundedAt)}` : ''}
                  {detail.refundedByName ? ` · ${detail.refundedByName}` : ''}
                </Text>
              ) : null}

              {(detail.payments || []).length > 0 ? (
                <Text style={styles.paymentsLine}>
                  {(detail.payments || [])
                    .map((p) => `${METHOD_LABELS[p.method] || p.method} ${formatMoney(p.amount)}`)
                    .join(' · ')}
                </Text>
              ) : null}

              <ScrollView style={styles.itemsScroll}>
                {detail.items.map((item) => {
                  const hasDiff = item.removed.length > 0 || item.added.length > 0;
                  return (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemHeader}>
                        <Text style={styles.itemName} numberOfLines={2}>
                          {item.name} × {item.qty}
                        </Text>
                        <Text style={styles.itemTotal}>{formatMoney(item.lineTotal)}</Text>
                      </View>
                      {hasDiff && (
                        <Text style={styles.itemDiff}>
                          {item.removed.length > 0 ? `без: ${item.removed.join(', ')}` : ''}
                          {item.removed.length > 0 && item.added.length > 0 ? '  ·  ' : ''}
                          {item.added.length > 0 ? `+ ${item.added.join(', ')}` : ''}
                        </Text>
                      )}
                      {!hasDiff && item.modifiers.length > 0 && (
                        <Text style={styles.itemComposition}>
                          {item.modifiers.map((m) => m.name).join(', ')}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Итого</Text>
                <Text style={[styles.totalValue, isRefunded && styles.totalRefunded]}>
                  {formatMoney(detail.total)}
                </Text>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </>
          ) : null}

          <View style={styles.actions}>
            {canPrintCopy ? (
              <Pressable
                style={[styles.copyBtn, busy && styles.refundBtnDisabled]}
                onPress={() => {
                  void doPrintCopy();
                }}
                disabled={busy}
              >
                <Text style={styles.copyBtnText}>Копия чека</Text>
              </Pressable>
            ) : null}
            {canRefund ? (
              <Pressable
                style={[styles.refundBtn, busy && styles.refundBtnDisabled]}
                onPress={confirmRefund}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.refundBtnText}>Вернуть</Text>
                )}
              </Pressable>
            ) : null}
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Закрыть</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
  },
  center: { paddingVertical: 32, alignItems: 'center' },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingVertical: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: 8 },
  refundedBadge: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  paymentsLine: { color: colors.accent2, fontSize: 13, marginBottom: 8 },
  itemsScroll: { marginBottom: 8 },
  itemRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  itemTotal: { color: colors.text, fontSize: 14, fontWeight: '600' },
  itemDiff: { color: colors.accent2, fontSize: 12, marginTop: 3 },
  itemComposition: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { color: colors.textMuted, fontSize: 14 },
  totalValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  totalRefunded: { textDecorationLine: 'line-through', color: colors.textMuted },
  actions: { marginTop: 10, gap: 4 },
  copyBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  refundBtn: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refundBtnDisabled: { opacity: 0.6 },
  refundBtnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modalCancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontSize: 14 },
});
