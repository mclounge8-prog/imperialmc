import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, Text, type StyleProp, type TextStyle } from 'react-native';
import AppUpdateGate from '../components/AppUpdateGate';
import KioskSettingsPanel from '../components/KioskSettingsPanel';
import { startKioskLock } from '../native/kioskLock';

type Chrome = {
  openSettings: () => void;
};

const KioskChromeContext = createContext<Chrome>({
  openSettings: () => undefined,
});

export function useKioskChrome(): Chrome {
  return useContext(KioskChromeContext);
}

export function VenueSecretTitle({
  name,
  style,
}: {
  name: string;
  style?: StyleProp<TextStyle>;
}) {
  const { openSettings } = useKioskChrome();
  const taps = useRef({ count: 0, at: 0 });

  const onPress = () => {
    const now = Date.now();
    if (now - taps.current.at > 1600) taps.current.count = 0;
    taps.current.at = now;
    taps.current.count += 1;
    if (taps.current.count >= 5) {
      taps.current.count = 0;
      openSettings();
    }
  };

  return (
    <Pressable onPress={onPress} hitSlop={12}>
      <Text style={style}>{name}</Text>
    </Pressable>
  );
}

export function KioskChrome({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    void startKioskLock();
  }, []);

  const openSettings = useCallback(() => setSettings(true), []);
  const closeSettings = useCallback(() => {
    setSettings(false);
    void startKioskLock();
  }, []);

  return (
    <KioskChromeContext.Provider value={{ openSettings }}>
      {children}
      {settings ? <KioskSettingsPanel onClose={closeSettings} /> : null}
      <AppUpdateGate autoCheck={false} channel="kiosk" />
    </KioskChromeContext.Provider>
  );
}
