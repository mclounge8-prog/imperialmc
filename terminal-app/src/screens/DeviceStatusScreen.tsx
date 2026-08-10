import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';

export default function DeviceStatusScreen() {
  const { status, error, refresh } = useDevice();
  const [refreshing, setRefreshing] = useState(false);

  const message = (() => {
    if (error) return error;
    if (status && !status.active) {
      return 'Устройство деактивировано администратором.\nОбратись к администратору, чтобы снова его включить.';
    }
    return 'Устройство зарегистрировано, но ещё не назначено ни на одно заведение.\nПопроси администратора назначить его в бэкофисе.';
  })();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.button} disabled={refreshing} onPress={handleRefresh}>
        {refreshing ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>Обновить</Text>
        )}
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
    gap: 20,
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
  },
});