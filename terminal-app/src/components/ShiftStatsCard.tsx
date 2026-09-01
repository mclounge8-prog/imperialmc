import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { Shift } from '../api/client';

function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PAYMENT_LABELS: Record<'cash' | 'card' | 'other', string> = {
  cash: 'Наличные',
  card: 'Карта',
  other: 'Другое',
};

export default function ShiftStatsCard({ shift }: { shift: Shift }) {
  const cash = shift.cash;
  const showCash = Boolean(cash) && shift.status === 'open';

  return (
    <View>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          Открыта {formatDateTime(shift.openedAt)}
          {shift.openedByName ? ` · ${shift.openedByName}` : ''}
        </Text>
        {shift.status === 'closed' && (
          <Text style={styles.metaText}>
            Закрыта {formatDateTime(shift.closedAt)}
            {shift.closedByName ? ` · ${shift.closedByName}` : ''}
          </Text>
        )}
      </View>

      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Выручка</Text>
          <Text style={styles.kpiValue}>{formatMoney(shift.revenueTotal)}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Чеков</Text>
          <Text style={styles.kpiValue}>{shift.receiptsCount}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Гостей</Text>
          <Text style={styles.kpiValue}>{shift.guestsCount}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Средний чек</Text>
          <Text style={styles.kpiValue}>{formatMoney(shift.avgCheck)}</Text>
        </View>
      </View>

      {showCash ? (
        <>
          <Text style={styles.sectionLabel}>Наличность в кассе</Text>
          <View style={[styles.card, styles.cashCard]}>
            <View style={styles.cashHero}>
              <Text style={styles.cashHeroLabel}>Сейчас в кассе (расчёт)</Text>
              <Text style={styles.cashHeroValue}>{formatMoney(cash.expectedCash)}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Остаток на открытии</Text>
              <Text style={styles.paymentValue}>{formatMoney(cash.openingCash)}</Text>
            </View>
            <View style={[styles.paymentRow, styles.paymentRowBorder]}>
              <Text style={styles.paymentLabel}>Наличные продажи</Text>
              <Text style={styles.paymentValue}>{formatMoney(cash.cashSales)}</Text>
            </View>
            <View style={[styles.paymentRow, styles.paymentRowBorder]}>
              <Text style={styles.paymentLabel}>Внесения</Text>
              <Text style={styles.paymentValue}>+{formatMoney(cash.deposits)}</Text>
            </View>
            <View style={[styles.paymentRow, styles.paymentRowBorder]}>
              <Text style={styles.paymentLabel}>Инкассации</Text>
              <Text style={styles.paymentValue}>−{formatMoney(cash.withdrawals)}</Text>
            </View>
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>По способу оплаты</Text>
      <View style={styles.card}>
        {(Object.keys(PAYMENT_LABELS) as Array<'cash' | 'card' | 'other'>).map((method, idx) => (
          <View key={method} style={[styles.paymentRow, idx < 2 && styles.paymentRowBorder]}>
            <Text style={styles.paymentLabel}>{PAYMENT_LABELS[method]}</Text>
            <Text style={styles.paymentValue}>{formatMoney(shift.paymentBreakdown[method])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: { marginBottom: 16, gap: 2 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  kpiCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  kpiLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  kpiValue: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  cashCard: { marginBottom: 20 },
  cashHero: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface2,
  },
  cashHeroLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  cashHeroValue: { color: colors.accent2, fontSize: 28, fontWeight: '800' },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  paymentRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  paymentLabel: { color: colors.text, fontSize: 14 },
  paymentValue: { color: colors.accent2, fontSize: 14, fontWeight: '600' },
});
