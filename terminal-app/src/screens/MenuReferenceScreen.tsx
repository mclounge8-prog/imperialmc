import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import MenuBrowser from '../components/MenuBrowser';
import CompositionModal from '../components/CompositionModal';
import type { CompositionTarget } from '../components/CompositionModal';
import { fetchMenu } from '../api/client';
import type { MenuResponse } from '../api/client';

export default function MenuReferenceScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compositionTarget, setCompositionTarget] = useState<CompositionTarget>(null);

  const load = useCallback(async () => {
    if (!session || !venue) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMenu(venue.id, session.token);
      setMenu(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить меню');
    } finally {
      setLoading(false);
    }
  }, [session, venue]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hintBar}>
        <Text style={styles.hintText}>Справочник меню — тап по позиции показывает состав</Text>
      </View>
      <MenuBrowser
        menu={menu}
        onItemPress={(item) => setCompositionTarget({ name: item.name, recipe: item.recipe })}
      />
      <CompositionModal target={compositionTarget} onClose={() => setCompositionTarget(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryText: { color: colors.text, fontSize: 14 },
  hintBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  hintText: { color: colors.textMuted, fontSize: 12 },
});