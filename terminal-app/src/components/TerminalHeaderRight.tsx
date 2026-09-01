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

const OK_GREEN = '#3d9a6a';

export default function TerminalHeaderRight() {
  const { session, logout } = useSession();
  const { status } = useDevice();
  const { errorCount, lastError, atolEnabled, pendingJobCount, serverOnline, serverMessage } =
    useFiscalAlerts();
  const venue = status?.venue ?? null;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();

  if (!session) return null;

  const showReferenceButton = route.name !== 'MenuReference';
  const showSettingsButton = !['Settings', 'XReport', 'ShiftReceipts', 'AtolStatus', 'Cash'].includes(
    route.name
  );
  const onStatusScreen = route.name === 'AtolStatus';

  const serverOk = serverOnline !== false;
  const serverLabel =
    serverOnline === false
      ? `Сервер · ошибка${serverMessage ? `: ${serverMessage}` : ''}`
      : 'Сервер · OK';

  let atolLabel = 'АТОЛ · —';
  let atolOk = true;
  if (atolEnabled === false) {
    atolLabel = 'АТОЛ · выкл';
    atolOk = true;
  } else if (errorCount > 0) {
    atolOk = false;
    atolLabel = `АТОЛ · ${errorCount}${lastError ? `: ${lastError.message}` : ''}`;
  } else if (pendingJobCount > 0) {
    atolOk = true;
    atolLabel = `АТОЛ · очередь ${pendingJobCount}`;
  } else if (atolEnabled === true) {
    atolLabel = 'АТОЛ · OK';
    atolOk = true;
  }

  return (
    <View style={styles.container}>
      {!onStatusScreen ? (
        <Pressable
          style={[styles.statusChip, serverOk ? styles.chipOk : styles.chipError]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('AtolStatus')}
        >
          <Text
            style={[styles.statusChipText, { color: serverOk ? OK_GREEN : colors.danger }]}
            numberOfLines={1}
          >
            {serverLabel}
          </Text>
        </Pressable>
      ) : null}

      {!onStatusScreen ? (
        <Pressable
          style={[styles.statusChip, atolOk ? styles.chipOk : styles.chipError]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('AtolStatus')}
        >
          <Text
            style={[styles.statusChipText, { color: atolOk ? OK_GREEN : colors.danger }]}
            numberOfLines={1}
          >
            {atolLabel}
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
    gap: 6,
    marginRight: 8,
    maxWidth: 620,
  },
  statusChip: {
    maxWidth: 150,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: ICON_BUTTON_SIZE,
    justifyContent: 'center',
  },
  chipOk: {
    borderColor: 'rgba(61, 154, 106, 0.55)',
    backgroundColor: 'rgba(61, 154, 106, 0.12)',
  },
  chipError: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(225, 76, 76, 0.15)',
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  referenceButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
