import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import type { RootStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function TerminalHeaderRight() {
  const { session, logout } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();

  if (!session) return null;

  // Справочник состава и настройки доступны с любого экрана, кроме самих себя —
  // иначе можно было бы навигировать на текущий же экран, что бессмысленно
  const showReferenceButton = route.name !== 'MenuReference';
  const showSettingsButton = !['Settings', 'XReport', 'ShiftReceipts'].includes(route.name);

  return (
    <View style={styles.container}>
      {showReferenceButton && (
        <Pressable
          style={styles.referenceButton}
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
          hitSlop={6}
        >
          <Text style={styles.gearButtonText}>⚙️</Text>
        </Pressable>
      )}
      <Pressable style={styles.button} onPress={logout}>
        <Text style={styles.buttonText}>Выйти</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 8,
    maxWidth: 340,
  },
  referenceButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  referenceButtonText: {
    color: colors.accent2,
    fontSize: 12,
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
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  buttonText: {
    color: colors.danger,
    fontSize: 12,
  },
  gearButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonText: {
    fontSize: 15,
  },
});