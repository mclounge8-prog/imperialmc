import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceProvider, useDevice } from './src/context/DeviceContext';
import { KioskChrome } from './src/kiosk/KioskChrome';
import DeviceRegistrationScreen from './src/screens/DeviceRegistrationScreen';
import DeviceStatusScreen from './src/screens/DeviceStatusScreen';
import KioskOrderScreen from './src/screens/KioskOrderScreen';
import { kk } from './src/kiosk/theme';

function KioskRoot() {
  const { deviceToken, status, loading } = useDevice();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: kk.bg }}>
        <ActivityIndicator color={kk.gold} size="large" />
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
        <KioskChrome>
          <StatusBar barStyle="light-content" backgroundColor={kk.bg} translucent />
          <KioskRoot />
        </KioskChrome>
      </DeviceProvider>
    </SafeAreaProvider>
  );
}
