import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  placeholder?: string;
  confirmLabel?: string;
  minLength?: number;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
};

export default function CommentPromptModal({
  visible,
  title,
  subtitle,
  placeholder = 'Комментарий',
  confirmLabel = 'Подтвердить',
  minLength = 3,
  onCancel,
  onConfirm,
}: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText('');
      setError(null);
    }
  }, [visible]);

  const handleConfirm = () => {
    const comment = text.trim();
    if (comment.length < minLength) {
      setError(`Введите комментарий (минимум ${minLength} символа)`);
      return;
    }
    onConfirm(comment);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.box} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={placeholder}
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.cancelText}>Отмена</Text>
              </Pressable>
              <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
                <Text style={styles.confirmText}>{confirmLabel}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
    textAlignVertical: 'top',
    fontSize: 15,
  },
  error: { color: '#e57373', fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.accent2,
  },
  confirmText: { color: '#111', fontWeight: '700' },
});
