import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

const PIN_LENGTH = 4;
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
  error?: string | null;
};

export default function PinPromptModal({
  visible,
  title,
  subtitle,
  onCancel,
  onSubmit,
  error = null,
}: Props) {
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPin('');
      setLocalError(null);
    }
  }, [visible]);

  useEffect(() => {
    // Сброс после неверного PIN, пока модалка остаётся открытой
    if (error) setPin('');
  }, [error]);

  const handleKey = (key: string) => {
    if (key === '') return;
    if (key === '⌫') {
      setPin((prev) => prev.slice(0, -1));
      setLocalError(null);
      return;
    }
    setPin((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const next = prev + key;
      if (next.length === PIN_LENGTH) {
        onSubmit(next);
      }
      return next;
    });
    setLocalError(null);
  };

  const displayError = localError || error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.dotsRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>

          <View style={styles.errorSlot}>
            {displayError ? <Text style={styles.errorText}>{displayError}</Text> : null}
          </View>

          <View style={styles.keypad}>
            {KEY_ROWS.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.keypadRow}>
                {row.map((key, i) => (
                  <Pressable
                    key={`${rowIndex}-${i}`}
                    style={[styles.key, key === '' && styles.keyEmpty]}
                    onPress={() => handleKey(key)}
                    disabled={key === ''}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          <Pressable style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginVertical: 12 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  dotFilled: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  errorSlot: { minHeight: 20, alignItems: 'center', marginBottom: 6 },
  errorText: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  keypad: { gap: 8 },
  keypadRow: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { color: colors.text, fontSize: 20, fontWeight: '600' },
  cancelBtn: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
