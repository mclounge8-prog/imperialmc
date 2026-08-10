import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { ICON_BUTTON_SIZE } from '../theme/sizes';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import { useFiscalAlerts } from '../context/FiscalAlertsContext';
import type { RootStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function TerminalHeaderRight() {
  const { session, logout } = useSession();
  const { status } = useDevice();
  const { errorCount, lastError } = useFiscalAlerts();
  const venue = status?.venue ?? null;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();

  if (!session) return null;

  const showReferenceButton = route.name !== 'MenuReference';
  const showSettingsButton = !['Settings', 'XReport', 'ShiftReceipts', 'AtolStatus'].includes(
    route.name
  );
  const showAtolChip = errorCount > 0 && route.name !== 'AtolStatus';

  return (
    <View style={styles.container}>
      {showAtolChip ? (
        <Pressable
          style={styles.atolChip}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('AtolStatus')}
        >
          <Text style={styles.atolChipText} numberOfLines={1}>
            АТОЛ · {errorCount}
            {lastError ? `: ${lastError.message}` : ''}
          </Text>
        </Pressable>
      ) : null}
      {showReferenceButton && (
        <Pressable
          style={styles.referenceButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('MenuReference')}
        >
          <Text style={styles.referenceButtonText}>📋 Состав</Text>
        </Pressable>
      )}
      <View style={styles.textBlock}>
        {venue && (
          <Text style={styles.venueName} numberOfLines={1}>
            {venue.name}
          </Text>
        )}
        <Text style={styles.name} numberOfLines={1}>
          {session.staff.name}
        </Text>
      </View>
      {showSettingsButton && (
        <Pressable
          style={styles.gearButton}
          onPress={() => navigation.navigate('Settings')}
          hitSlop={8}
        >
          <Text style={styles.gearButtonText}>⚙️</Text>
        </Pressable>
      )}
      <Pressable
        style={styles.button}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={logout}
      >
        <Text style={styles.buttonText}>Выйти</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
    maxWidth: 520,
  },
  atolChip: {
    maxWidth: 180,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: 'rgba(225, 76, 76, 0.15)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: ICON_BUTTON_SIZE,
    justifyContent: 'center',
  },
  atolChipText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  referenceButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: ICON_BUTTON_SIZE,
    justifyContent: 'center',
  },
  referenceButtonText: {
    color: colors.accent2,
    fontSize: 14,
    fontWeight: '600',
  },
  textBlock: {
    flexShrink: 1,
  },
  venueName: {
    color: colors.accent2,
    fontSize: 11,
  },
  name: {
    color: colors.textMuted,
    fontSize: 13,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: ICON_BUTTON_SIZE,
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  gearButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonText: {
    fontSize: 20,
  },
});
