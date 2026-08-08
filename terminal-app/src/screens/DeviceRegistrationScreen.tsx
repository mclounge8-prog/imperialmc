import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';

export default function DeviceRegistrationScreen() {
  const { register } = useDevice();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    try {
      await register(trimmed.toUpperCase());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось зарегистрировать устройство');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Регистрация устройства</Text>
      <Text style={styles.subtitle}>
        Получи код в бэкофисе (раздел «Устройства» → «Сгенерировать код регистрации») и введи его
        здесь.
      </Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="XXXXXX"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={10}
        editable={!loading}
      />

      <View style={styles.errorSlot}>
        {loading ? (
          <ActivityIndicator color={colors.accent2} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
      </View>

      <Pressable style={styles.button} disabled={loading || !code.trim()} onPress={handleSubmit}>
        <Text style={styles.buttonText}>Зарегистрировать</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
    maxWidth: 320,
  },
  input: {
    width: '100%',
    maxWidth: 260,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: 14,
    marginBottom: 8,
  },
  errorSlot: {
    height: 28,
    justifyContent: 'center',
    marginBottom: 8,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonText: {
    color: '#f1f1f3',
    fontSize: 16,
    fontWeight: '600',
  },
});