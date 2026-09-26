import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { paymentMethodLabel, paymentMethodTint } from '../kiosk/status';

const CASH_KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

type PayMethod = 'cash' | 'card' | 'qr';

type Props = {
  visible: boolean;
  amount: number;
  subtotal?: number;
  discountPercent?: number;
  qrDiscountPercent?: number;
  suggestedMethod?: PayMethod | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (method: PayMethod, payable: number) => void;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function StaffPaymentModal({
  visible,
  amount,
  subtotal,
  discountPercent,
  qrDiscountPercent,
  suggestedMethod,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [picked, setPicked] = useState<PayMethod>(suggestedMethod || 'cash');
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [cashText, setCashText] = useState('');

  const sub = Number(subtotal ?? amount);
  const qrPct = Number(discountPercent) > 0 ? Number(discountPercent) : Number(qrDiscountPercent ?? 12);
  const payable = useMemo(
    () => (picked === 'qr' ? roundMoney(sub - roundMoney((sub * qrPct) / 100)) : roundMoney(sub)),
    [picked, sub, qrPct]
  );
  const discountDropped = Boolean(suggestedMethod === 'qr' && picked !== 'qr' && qrPct > 0);
  const discountApplied = picked === 'qr' && qrPct > 0;
  const received = parseFloat(cashText.replace(',', '.')) || 0;
  const change = received - payable;
  const canCash = received >= payable - 0.001;

  useEffect(() => {
    if (visible) {
      setPicked(suggestedMethod || 'cash');
      setStep('pick');
      setCashText('');
    }
  }, [visible, suggestedMethod]);

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
          <Text style={styles.title}>Оплата киоска</Text>
          {suggestedMethod ? (
            <Text style={styles.guestPick}>
              Гость выбрал:{' '}
              <Text style={{ color: paymentMethodTint(suggestedMethod), fontWeight: '800' }}>
                {paymentMethodLabel(suggestedMethod)}
              </Text>
            </Text>
          ) : null}
          <Text style={styles.amount}>{payable.toFixed(2)} ₽</Text>
          {discountApplied ? (
            <Text style={styles.hint}>
              было {sub.toFixed(2)} ₽ · скидка {qrPct}% за QR
            </Text>
          ) : discountDropped ? (
            <Text style={styles.warn}>Скидка QR снята · к оплате полная сумма</Text>
          ) : (
            <Text style={styles.hint}>Без скидки</Text>
          )}

          {busy ? (
            <ActivityIndicator color={colors.accent2} style={{ marginVertical: 24 }} />
          ) : step === 'pick' ? (
            <>
              <Text style={styles.sub}>Можно сменить способ, пока оплата не проведена</Text>
              {(['cash', 'card', 'qr'] as PayMethod[]).map((key) => (
                <Pressable
                  key={key}
                  style={[styles.methodBtn, picked === key && styles.methodBtnOn]}
                  onPress={() => setPicked(key)}
                >
                  <Text style={[styles.methodLabel, { color: paymentMethodTint(key) }]}>{paymentMethodLabel(key)}</Text>
                  {suggestedMethod === key ? <Text style={styles.methodHint}>выбор гостя</Text> : null}
                </Pressable>
              ))}
              <Pressable style={styles.primary} onPress={() => setStep('confirm')}>
                <Text style={styles.primaryText}>Далее · {paymentMethodLabel(picked)}</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelText}>Отмена</Text>
              </Pressable>
            </>
          ) : picked === 'qr' ? (
            <>
              <Text style={styles.qrLead}>
                Проверь скрин перевода. Если гость передумал и платит иначе — вернись и смени способ.
              </Text>
              <Pressable style={styles.primary} onPress={() => onConfirm('qr', payable)}>
                <Text style={styles.primaryText}>Подтвердить оплату по QR</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setStep('pick')}>
                <Text style={styles.cancelText}>← Сменить способ</Text>
              </Pressable>
            </>
          ) : picked === 'card' ? (
            <>
              <Text style={styles.qrLead}>Проведи оплату на терминале и подтверди.</Text>
              <Pressable style={styles.primary} onPress={() => onConfirm('card', payable)}>
                <Text style={styles.primaryText}>Подтвердить оплату картой</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setStep('pick')}>
                <Text style={styles.cancelText}>← Сменить способ</Text>
              </Pressable>
            </>
          ) : (
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
              <Pressable
                style={[styles.primary, !canCash && styles.off]}
                disabled={!canCash}
                onPress={() => onConfirm('cash', payable)}
              >
                <Text style={styles.primaryText}>Подтвердить наличные</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setStep('pick')}>
                <Text style={styles.cancelText}>← Сменить способ</Text>
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
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  guestPick: { color: colors.textMuted, marginTop: 6, fontSize: 15 },
  amount: { color: colors.accent2, fontSize: 32, fontWeight: '800', marginTop: 6 },
  hint: { color: colors.textMuted, marginTop: 4 },
  warn: { color: '#fbbf24', marginTop: 4, fontWeight: '800' },
  qrLead: { color: colors.text, fontSize: 16, lineHeight: 22, marginTop: 14, marginBottom: 8 },
  sub: { color: colors.textMuted, marginTop: 14, marginBottom: 8, fontWeight: '700' },
  methodBtn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    paddingHorizontal: 14,
    marginBottom: 8,
    justifyContent: 'center',
  },
  methodBtnOn: { borderColor: colors.accent2, backgroundColor: '#1a2748' },
  methodLabel: { fontSize: 18, fontWeight: '800' },
  methodHint: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
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
    marginTop: 12,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  off: { opacity: 0.4 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: colors.textMuted, fontWeight: '700' },
  error: { color: colors.danger, textAlign: 'center', marginTop: 8, fontWeight: '700' },
});
