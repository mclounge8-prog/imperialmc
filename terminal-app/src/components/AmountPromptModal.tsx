import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  initialValue?: string;
  allowZero?: boolean;
  onCancel: () => void;
  onConfirm: (amount: number) => void;
};

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

/** Свой экранный номпад — без системной Android-клавиатуры (как при оплате наличными). */
export default function AmountPromptModal({
  visible,
  title,
  subtitle,
  confirmLabel = 'Подтвердить',
  initialValue = '0',
  allowZero = true,
  onCancel,
  onConfirm,
}: Props) {
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText(initialValue === '' ? '0' : initialValue);
      setError(null);
    }
  }, [visible, initialValue]);

  const handleKeyPress = (key: string) => {
    setError(null);
    if (key === '⌫') {
      setText((prev) => {
        const next = prev.slice(0, -1);
        return next === '' ? '0' : next;
      });
      return;
    }
    if (key === '.') {
      setText((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : `${prev}.`));
      return;
    }
    setText((prev) => {
      const dotIndex = prev.indexOf('.');
      if (dotIndex !== -1 && prev.length - dotIndex > 2) return prev;
      if (prev === '0') return key;
      return prev + key;
    });
  };

  const handleConfirm = () => {
    const normalized = text.replace(',', '.').trim();
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Введите корректную сумму');
      return;
    }
    if (!allowZero && amount <= 0) {
      setError('Сумма должна быть больше нуля');
      return;
    }
    onConfirm(Math.round(amount * 100) / 100);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.display}>
            <Text style={styles.displayText}>{text || '0'} ₽</Text>
          </View>

          <View style={styles.keypad}>
            {KEY_ROWS.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.keypadRow}>
                {row.map((key) => (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                    onPress={() => handleKeyPress(key)}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={onCancel}>
              <Text style={styles.secondaryText}>Отмена</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={handleConfirm}>
              <Text style={styles.primaryText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  display: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'flex-end',
  },
  displayText: { color: colors.text, fontSize: 28, fontWeight: '700' },
  keypad: { gap: 8, marginTop: 4 },
  keypadRow: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { opacity: 0.7, backgroundColor: colors.border },
  keyText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
