import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';

export default function DeviceStatusScreen() {
  const { status, error, refresh, clearRegistration } = useDevice();
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const message = (() => {
    if (error) return error;
    if (status && !status.active) {
      return 'Устройство деактивировано администратором.\nОбратись к администратору, чтобы снова его включить.';
    }
    return 'Устройство зарегистрировано, но ещё не назначено ни на одно заведение.\nПопроси администратора назначить его в бэкофисе (раздел «Устройства»).';
  })();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleReregister = async () => {
    setClearing(true);
    try {
      await clearRegistration();
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.button} disabled={refreshing || clearing} onPress={handleRefresh}>
        {refreshing ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>Обновить</Text>
        )}
      </Pressable>
      <Pressable
        style={[styles.button, styles.primaryButton]}
        disabled={refreshing || clearing}
        onPress={handleReregister}
      >
        {clearing ? (
          <ActivityIndicator color="#f1f1f3" />
        ) : (
          <Text style={styles.primaryButtonText}>Зарегистрировать заново</Text>
        )}
      </Pressable>
      <Text style={styles.hint}>
        Чтобы сменить точку, в бэкофисе достаточно выбрать другое заведение у этого устройства —
        удалять его не обязательно. Если устройство уже удалили — нажми «Зарегистрировать заново» и
        введи новый код.
      </Text>
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
    gap: 16,
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 340,
    marginTop: 8,
    opacity: 0.85,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    minWidth: 220,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
  },
  primaryButtonText: {
    color: '#f1f1f3',
    fontSize: 14,
    fontWeight: '600',
  },
});
