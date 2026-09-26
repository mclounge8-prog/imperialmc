import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import UpdateCheckRow from './UpdateCheckRow';
import { startKioskLock, stopKioskLock } from '../native/kioskLock';

type Props = {
  onClose: () => void;
};

export default function KioskSettingsPanel({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [unlocked, setUnlocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const unlockNav = async () => {
    try {
      await stopKioskLock();
      setUnlocked(true);
      setHint('Нижние кнопки Android открыты. Можно свернуть приложение.');
    } catch (e) {
      setHint(e instanceof Error ? e.message : 'Не удалось разблокировать');
    }
  };

  const relock = async () => {
    try {
      await startKioskLock();
      setUnlocked(false);
      setHint('Киоск снова зафиксирован на экране.');
    } catch (e) {
      setHint(e instanceof Error ? e.message : 'Не удалось заблокировать');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.eyebrow}>Служебное меню</Text>
      <Text style={styles.title}>Настройки киоска</Text>
      <Text style={styles.lead}>
        Гостевой экран нельзя свернуть с панели Android. Сначала разблокируй кнопки здесь.
      </Text>

      <Text style={styles.section}>Приложение</Text>
      <UpdateCheckRow channel="kiosk" />

      <Text style={styles.section}>Система</Text>
      <Pressable style={[styles.btn, unlocked && styles.btnOn]} onPress={() => void unlockNav()}>
        <Text style={styles.btnText}>Показать кнопки Android</Text>
        <Text style={styles.btnSub}>Разблокирует нижнее меню, чтобы свернуть киоск</Text>
      </Pressable>
      <Pressable style={styles.btnGhost} onPress={() => void relock()}>
        <Text style={styles.btnGhostText}>Снова зафиксировать экран</Text>
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Pressable style={styles.close} onPress={onClose}>
        <Text style={styles.closeText}>Закрыть и вернуться к киоску</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    zIndex: 40,
    elevation: 20,
  },
  eyebrow: {
    color: colors.accent2,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 13,
  },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: 6 },
  lead: { color: colors.textMuted, fontSize: 16, lineHeight: 22, marginTop: 10, maxWidth: 560 },
  section: {
    color: colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 28,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
    gap: 4,
  },
  btnOn: { borderColor: colors.accent2 },
  btnText: { color: colors.text, fontSize: 20, fontWeight: '800' },
  btnSub: { color: colors.textMuted, fontSize: 14 },
  btnGhost: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnGhostText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.accent2, marginTop: 12, fontSize: 15 },
  close: {
    marginTop: 'auto',
    backgroundColor: colors.accent2,
    borderRadius: 16,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '800' },
});
