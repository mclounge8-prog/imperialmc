import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { paymentMethodLabel } from '../kiosk/status';

const CASH_KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

type Props = {
  visible: boolean;
  amount: number;
  subtotal?: number;
  discountPercent?: number;
  suggestedMethod?: 'cash' | 'card' | 'qr' | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (method: 'cash' | 'card') => void;
};

export default function StaffPaymentModal({
  visible,
  amount,
  subtotal,
  discountPercent,
  suggestedMethod,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [cashMode, setCashMode] = useState(false);
  const [cashText, setCashText] = useState('');
  const received = parseFloat(cashText.replace(',', '.')) || 0;
  const change = received - amount;
  const canCash = received >= amount - 0.001;
  const guestChoice = paymentMethodLabel(suggestedMethod);

  useEffect(() => {
    if (visible) {
      setCashMode(false);
      setCashText('');
    }
  }, [visible]);

  const onKey = (key: string) => {
    if (key === '⌫') {
      setCashText((prev) => prev.slice(0, -1));
      return;
    }
    if (key === '.') {
      setCashText((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : `${prev}.`));
      return;
    }
    setCashText((prev) => {
      const dotIndex = prev.indexOf('.');
      if (dotIndex !== -1 && prev.length - dotIndex > 2) return prev;
      if (prev === '0') return key;
      return prev + key;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()}>
        <Pressable style={styles.box} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Оплата — киоск</Text>
          <Text style={styles.amount}>{amount.toFixed(2)} ₽</Text>
          {discountPercent ? (
            <Text style={styles.hint}>
              было {(subtotal ?? amount).toFixed(2)} ₽ · скидка {discountPercent}%
            </Text>
          ) : null}
          {guestChoice ? <Text style={styles.hint}>Гость на киоске выбрал: {guestChoice}</Text> : null}

          {busy ? (
            <ActivityIndicator color={colors.accent2} style={{ marginVertical: 24 }} />
          ) : cashMode ? (
            <>
              <Text style={styles.sub}>Сколько дал гость?</Text>
              <View style={styles.display}>
                <Text style={styles.displayText}>{cashText || '0'} ₽</Text>
              </View>
              <View style={styles.keys}>
                {CASH_KEY_ROWS.map((row) => (
                  <View key={row.join()} style={styles.keyRow}>
                    {row.map((key) => (
                      <Pressable key={key} style={styles.key} onPress={() => onKey(key)}>
                        <Text style={styles.keyText}>{key}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>Сдача</Text>
                <Text style={[styles.changeValue, change < 0 && styles.neg]}>{change.toFixed(2)} ₽</Text>
              </View>
              <Pressable style={[styles.primary, !canCash && styles.off]} disabled={!canCash} onPress={() => onConfirm('cash')}>
                <Text style={styles.primaryText}>Подтвердить наличные</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setCashMode(false)}>
                <Text style={styles.cancelText}>← Назад к способу оплаты</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.sub}>Выбери способ оплаты по факту</Text>
              <Pressable style={[styles.methodBtn, styles.methodCash]} onPress={() => setCashMode(true)}>
                <Text style={styles.methodIcon}>💵</Text>
                <Text style={styles.methodLabel}>Наличные</Text>
              </Pressable>
              <Pressable style={[styles.methodBtn, styles.methodCard]} onPress={() => onConfirm('card')}>
                <Text style={styles.methodIcon}>💳</Text>
                <Text style={styles.methodLabel}>Безналичный</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelText}>Отмена</Text>
              </Pressable>
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  box: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  amount: { color: colors.accent2, fontSize: 32, fontWeight: '800', marginTop: 6 },
  hint: { color: colors.textMuted, marginTop: 4 },
  sub: { color: colors.textMuted, marginTop: 14, marginBottom: 10, fontWeight: '700' },
  methodBtn: {
    minHeight: 72,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
  },
  methodCash: { backgroundColor: '#1f3d2a' },
  methodCard: { backgroundColor: '#1a2748' },
  methodIcon: { fontSize: 28 },
  methodLabel: { color: colors.text, fontSize: 20, fontWeight: '800' },
  display: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  displayText: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  keys: { gap: 8 },
  keyRow: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    minHeight: 52,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 12 },
  changeLabel: { color: colors.textMuted, fontWeight: '700' },
  changeValue: { color: colors.text, fontWeight: '800', fontSize: 18 },
  neg: { color: colors.danger },
  primary: {
    backgroundColor: colors.accent2,
    borderRadius: 12,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  off: { opacity: 0.4 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: colors.textMuted, fontWeight: '700' },
  error: { color: colors.danger, textAlign: 'center', marginTop: 8, fontWeight: '700' },
});
