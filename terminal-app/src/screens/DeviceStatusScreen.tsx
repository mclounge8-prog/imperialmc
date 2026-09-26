import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';
import BrandMark from '../kiosk/BrandMark';
import { VenueSecretTitle } from '../kiosk/KioskChrome';
import { kk } from '../kiosk/theme';

export default function DeviceStatusScreen() {
  const { status, error, refresh, clearRegistration, kind } = useDevice();
  const isKiosk = kind === 'kiosk';
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
    <View style={[styles.container, isKiosk && styles.kioskContainer]}>
      {isKiosk ? <BrandMark size="lg" /> : null}
      {isKiosk ? <VenueSecretTitle name="Киоск" style={styles.kioskTitle} /> : null}
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.button} disabled={refreshing || clearing} onPress={handleRefresh}>
        {refreshing ? (
          <ActivityIndicator color={isKiosk ? kk.gold : colors.text} />
        ) : (
          <Text style={[styles.buttonText, isKiosk && { color: kk.cream }]}>Обновить</Text>
        )}
      </Pressable>
      <Pressable
        style={[styles.button, styles.primaryButton, isKiosk && styles.kioskPrimary]}
        disabled={refreshing || clearing}
        onPress={handleReregister}
      >
        {clearing ? (
          <ActivityIndicator color="#f1f1f3" />
        ) : (
          <Text style={[styles.primaryButtonText, isKiosk && styles.kioskPrimaryText]}>
            Зарегистрировать заново
          </Text>
        )}
      </Pressable>
      <Text style={styles.hint}>
        {isKiosk
          ? 'Киоск — отдельное устройство в бэкофисе. Терминал на этом планшете не сбрасывается. Назначь заведение и включи киоск на карточке точки.'
          : 'Чтобы сменить точку, в бэкофисе достаточно выбрать другое заведение у этого устройства — удалять его не обязательно. Если устройство уже удалили — нажми «Зарегистрировать заново» и введи новый код.'}
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
  kioskContainer: { backgroundColor: kk.bg },
  kioskTitle: { color: kk.gold, fontSize: 22, fontWeight: '800' },
  kioskPrimary: { backgroundColor: kk.gold, borderColor: kk.gold },
  kioskPrimaryText: { color: kk.ink, fontWeight: '800' },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
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
