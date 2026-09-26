import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceProvider, useDevice } from './src/context/DeviceContext';
import DeviceRegistrationScreen from './src/screens/DeviceRegistrationScreen';
import DeviceStatusScreen from './src/screens/DeviceStatusScreen';
import KioskOrderScreen from './src/screens/KioskOrderScreen';
import { colors } from './src/theme/colors';

function KioskRoot() {
  const { deviceToken, status, loading } = useDevice();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (!deviceToken) {
    return <DeviceRegistrationScreen />;
  }

  const usable = Boolean(status && status.active && status.venue);
  if (!usable) {
    return <DeviceStatusScreen />;
  }

  return <KioskOrderScreen />;
}

export default function KioskApp() {
  return (
    <SafeAreaProvider>
      <DeviceProvider kind="kiosk">
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <KioskRoot />
      </DeviceProvider>
    </SafeAreaProvider>
  );
}
