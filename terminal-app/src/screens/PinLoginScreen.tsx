import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { loginWithPin } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';

const PIN_LENGTH = 4;
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function PinLoginScreen() {
  const { login } = useSession();
  const { deviceToken } = useDevice();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPin = useCallback(
    async (value: string) => {
      if (!deviceToken) {
        setError('Устройство не зарегистрировано');
        setPin('');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await loginWithPin(value, deviceToken);
        login(result);
        setPin('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось войти');
        setPin('');
      } finally {
        setLoading(false);
      }
    },
    [login, deviceToken]
  );

  const handleKeyPress = (key: string) => {
    if (loading || key === '') return;

    if (key === '⌫') {
      setPin((prev) => prev.slice(0, -1));
      setError(null);
      return;
    }

    setPin((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const next = prev + key;
      if (next.length === PIN_LENGTH) {
        submitPin(next);
      }
      return next;
    });
    setError(null);
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/logo-white.webp')}
        style={styles.logo}
        resizeMode="contain"
      />

      <Text style={styles.title}>Вход по PIN</Text>

      <View style={styles.dotsRow}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
        ))}
      </View>

      <View style={styles.errorSlot}>
        {loading ? (
          <ActivityIndicator color={colors.accent2} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
      </View>

      <View style={styles.keypad}>
        {KEY_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((key, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [
                  styles.key,
                  key === '' && styles.keyHidden,
                  pressed && key !== '' && styles.keyPressed,
                ]}
                disabled={key === '' || loading}
                onPress={() => handleKeyPress(key)}
              >
                <Text style={styles.keyText}>{key}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
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
  logo: {
    width: 180,
    height: 60,
    marginBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  dotFilled: {
    backgroundColor: colors.accent2,
    borderColor: colors.accent2,
  },
  errorSlot: {
    height: 28,
    justifyContent: 'center',
    marginBottom: 8,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
  },
  keypad: {
    alignItems: 'center',
  },
  keypadRow: {
    flexDirection: 'row',
  },
  key: {
    width: 80,
    height: 80,
    margin: 8,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: colors.surface2,
    borderColor: colors.accent2,
  },
  keyHidden: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  keyText: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '500',
  },
});