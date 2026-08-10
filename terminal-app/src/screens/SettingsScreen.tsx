import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import ShiftToggle from '../components/ShiftToggle';
import type { RootStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type SettingsRow = {
  key: keyof RootStackParamList;
  icon: string;
  title: string;
  subtitle: string;
};

const ROWS: SettingsRow[] = [
  { key: 'XReport', icon: '📊', title: 'X-отчёт', subtitle: 'Сводка по текущей смене без закрытия' },
  { key: 'ShiftReceipts', icon: '🧾', title: 'Чеки', subtitle: 'Чеки текущей смены' },
];

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ShiftToggle />

      <Text style={styles.sectionLabel}>Отчёты по смене</Text>
      <View style={styles.card}>
        {ROWS.map((row, idx) => (
          <Pressable
            key={row.key}
            style={[styles.row, idx < ROWS.length - 1 && styles.rowBorder]}
            onPress={() => navigation.navigate(row.key as never)}
          >
            <Text style={styles.rowIcon}>{row.icon}</Text>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Оборудование</Text>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => navigation.navigate('AtolStatus')}>
          <Text style={styles.rowIcon}>🖨️</Text>
          <View style={styles.rowTextBlock}>
            <Text style={styles.rowTitle}>Касса АТОЛ</Text>
            <Text style={styles.rowSubtitle}>Статус, ошибки и очередь фискальных заданий</Text>
          </View>
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 8 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: { fontSize: 20 },
  rowTextBlock: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowChevron: { color: colors.textMuted, fontSize: 20 },
});
