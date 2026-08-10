import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/context/SessionContext';
import { DeviceProvider, useDevice } from './src/context/DeviceContext';
import PinLoginScreen from './src/screens/PinLoginScreen';
import DeviceRegistrationScreen from './src/screens/DeviceRegistrationScreen';
import DeviceStatusScreen from './src/screens/DeviceStatusScreen';
import TablesScreen from './src/screens/TablesScreen';
import OrderScreen from './src/screens/OrderScreen';
import MenuReferenceScreen from './src/screens/MenuReferenceScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import XReportScreen from './src/screens/XReportScreen';
import ShiftReceiptsScreen from './src/screens/ShiftReceiptsScreen';
import TerminalHeaderRight from './src/components/TerminalHeaderRight';
import { FiscalAlertsProvider } from './src/context/FiscalAlertsContext';
import { useFiscalSync } from './src/hooks/useFiscalSync';
import AtolStatusScreen from './src/screens/AtolStatusScreen';
import { colors } from './src/theme/colors';

export type RootStackParamList = {
  PinLogin: undefined;
  DeviceRegistration: undefined;
  DeviceStatus: undefined;
  Tables: undefined;
  Order: { orderId?: number; tableId: number | null; tableName: string };
  MenuReference: undefined;
  Settings: undefined;
  XReport: undefined;
  ShiftReceipts: undefined;
  AtolStatus: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
  headerRight: () => <TerminalHeaderRight />,
};

function RootNavigator() {
  const { session } = useSession();
  const { deviceToken, status, loading: deviceLoading } = useDevice();

  // Разбор очереди фискальных заданий (касса АТОЛ) — работает на фоне, пока
  // есть сессия и заведение, независимо от текущего экрана.
  useFiscalSync(status?.venue?.id ?? null, session?.token ?? null);

  if (deviceLoading) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}
      >
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  // Устройство ещё не зарегистрировано вообще — единственный экран, доступный без
  // всего остального. Регистрация происходит один раз через код из бэкофиса.
  const isRegistered = Boolean(deviceToken);
  // Зарегистрировано, но администратор ещё не назначил заведение или деактивировал —
  // работать в этом состоянии нельзя, показываем статус вместо входа по PIN.
  const isUsable = Boolean(status && status.active && status.venue);

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!isRegistered ? (
        <Stack.Screen
          name="DeviceRegistration"
          component={DeviceRegistrationScreen}
          options={{ headerShown: false }}
        />
      ) : !isUsable ? (
        <Stack.Screen
          name="DeviceStatus"
          component={DeviceStatusScreen}
          options={{ title: 'Music Community Terminal' }}
        />
      ) : !session ? (
        <Stack.Screen name="PinLogin" component={PinLoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen
            name="Tables"
            component={TablesScreen}
            options={{ title: 'Music Community Terminal' }}
          />
          <Stack.Screen
            name="Order"
            component={OrderScreen}
            options={({ route }) => ({ title: route.params.tableName })}
          />
          <Stack.Screen
            name="MenuReference"
            component={MenuReferenceScreen}
            options={{ title: 'Справочник меню' }}
          />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Настройки' }} />
          <Stack.Screen name="XReport" component={XReportScreen} options={{ title: 'X-отчёт' }} />
          <Stack.Screen
            name="ShiftReceipts"
            component={ShiftReceiptsScreen}
            options={{ title: 'Чеки смены' }}
          />
          <Stack.Screen
            name="AtolStatus"
            component={AtolStatusScreen}
            options={{ title: 'Касса АТОЛ' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DeviceProvider>
        <SessionProvider>
          <FiscalAlertsProvider>
            <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </FiscalAlertsProvider>
        </SessionProvider>
      </DeviceProvider>
    </SafeAreaProvider>
  );
}