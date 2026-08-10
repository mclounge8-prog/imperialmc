import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { fetchPaidReceiptDetail } from '../api/client';
import type { PaidReceiptDetail } from '../api/client';

function formatMoney(value: number): string {
  return `${value.toFixed(0)} ₽`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  receiptId: number | null;
  token: string;
  onClose: () => void;
};

// Состав оплаченного чека — что было продано и, для каждой позиции, что из
// стандартного состава убрали, а что докупили сверху (сравнение с текущими
// настройками позиции меню в бэкофисе).
export default function PaidReceiptDetailModal({ receiptId, token, onClose }: Props) {
  const [detail, setDetail] = useState<PaidReceiptDetail | null>(null);
  const [loading, setLoading] = useState(false);
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

  return (
    <Modal visible={receiptId !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent2} size="large" />
            </View>
          ) : error ? (
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
                <Text style={styles.totalValue}>{formatMoney(detail.total)}</Text>
              </View>
            </>
          ) : null}

          <Pressable style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>Закрыть</Text>
          </Pressable>
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
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: 12 },
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
  modalCancel: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontSize: 14 },
});
