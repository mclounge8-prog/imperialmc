import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  createCashMovement,
  fetchCashMovements,
  fetchCurrentShift,
  type CashMovement,
  type CashMovementType,
  type Shift,
} from '../api/client';
import AmountPromptModal from '../components/AmountPromptModal';
import { useDevice } from '../context/DeviceContext';
import { useSession } from '../context/SessionContext';
import { runPendingFiscalJobs } from '../services/fiscalWorker';
import { colors } from '../theme/colors';

function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CashScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venueId = status?.venue?.id ?? null;

  const [shift, setShift] = useState<Shift | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptType, setPromptType] = useState<CashMovementType | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!venueId || !session?.token) return;
    setError(null);
    try {
      const [current, list] = await Promise.all([
        fetchCurrentShift(venueId, session.token),
        fetchCashMovements(venueId, session.token),
      ]);
      setShift(current);
      setMovements(list.movements);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [venueId, session?.token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const submitMovement = async (amount: number) => {
    if (!venueId || !session?.token || !promptType) return;
    setBusy(true);
    setPromptType(null);
    try {
      const result = await createCashMovement(venueId, session.token, promptType, amount);
      setShift(result.shift);
      runPendingFiscalJobs(venueId, session.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (!shift) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Смена не открыта</Text>
        <Text style={styles.hint}>Откройте смену, чтобы вносить и изымать наличные.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accent2}
        />
      }
    >
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Сейчас в кассе (расчёт)</Text>
        <Text style={styles.heroValue}>{formatMoney(shift.cash.expectedCash)}</Text>
        <Text style={styles.heroMeta}>
          Открытие {formatMoney(shift.cash.openingCash)} · продажи {formatMoney(shift.cash.cashSales)} ·
          внесения {formatMoney(shift.cash.deposits)} · инкассации {formatMoney(shift.cash.withdrawals)}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.depositBtn]}
          disabled={busy}
          onPress={() => setPromptType('deposit')}
        >
          <Text style={styles.actionTitle}>Внесение</Text>
          <Text style={styles.actionSub}>Пополнить кассу</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.withdrawBtn]}
          disabled={busy}
          onPress={() => setPromptType('withdrawal')}
        >
          <Text style={styles.actionTitle}>Инкассация</Text>
          <Text style={styles.actionSub}>Изъять наличные</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Операции смены</Text>
      {movements.length === 0 ? (
        <Text style={styles.empty}>Пока не было внесений и инкассаций</Text>
      ) : (
        <View style={styles.card}>
          {movements.map((m, idx) => (
            <View key={m.id} style={[styles.row, idx < movements.length - 1 && styles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {m.type === 'deposit' ? 'Внесение' : 'Инкассация'}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatWhen(m.createdAt)}
                  {m.staffName ? ` · ${m.staffName}` : ''}
                  {m.comment ? ` · ${m.comment}` : ''}
                </Text>
              </View>
              <Text
                style={[
                  styles.rowAmount,
                  { color: m.type === 'deposit' ? '#3d9a6a' : colors.danger },
                ]}
              >
                {m.type === 'deposit' ? '+' : '−'}
                {formatMoney(m.amount)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <AmountPromptModal
        visible={promptType != null}
        title={promptType === 'deposit' ? 'Внесение наличных' : 'Инкассация'}
        subtitle="Сумма уйдёт в учёт смены и напечатается учётным чеком на АТОЛ."
        confirmLabel={promptType === 'deposit' ? 'Внести' : 'Изымать'}
        initialValue=""
        allowZero={false}
        onCancel={() => setPromptType(null)}
        onConfirm={submitMovement}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  errorBanner: {
    color: colors.danger,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
  },
  hero: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
  },
  heroLabel: { color: colors.textMuted, fontSize: 12 },
  heroValue: { color: colors.accent2, fontSize: 32, fontWeight: '800', marginTop: 4 },
  heroMeta: { color: colors.textMuted, fontSize: 12, marginTop: 8, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    minHeight: 84,
    justifyContent: 'center',
  },
  depositBtn: { backgroundColor: 'rgba(61,154,106,0.12)', borderColor: '#3d9a6a' },
  withdrawBtn: { backgroundColor: 'rgba(225,76,76,0.12)', borderColor: colors.danger },
  actionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  actionSub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
    marginLeft: 4,
  },
  empty: { color: colors.textMuted, fontSize: 13, marginLeft: 4 },
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
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700' },
});
