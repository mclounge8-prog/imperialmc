import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import { fetchKioskTickets, setKioskTicketStatus } from '../api/client';
import type { KioskTicket, KioskTicketStatus } from '../api/client';
import ScreenSwipeHost from '../components/ScreenSwipeHost';

const COLUMNS: { key: KioskTicketStatus; title: string; tint: string }[] = [
  { key: 'new', title: 'Новые', tint: '#8aa4ff' },
  { key: 'cooking', title: 'Готовятся', tint: '#d4a017' },
  { key: 'ready', title: 'Готовы', tint: '#6ee7a8' },
  { key: 'issued', title: 'Выданы', tint: colors.textMuted },
];

const NEXT: Partial<Record<KioskTicketStatus, { status: KioskTicketStatus; label: string }>> = {
  new: { status: 'cooking', label: 'Готовить' },
  cooking: { status: 'ready', label: 'Готово' },
  ready: { status: 'issued', label: 'Выдать' },
};

function formatTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function modsText(ticket: KioskTicket): string[] {
  return ticket.items.map((item) => {
    const mods = item.modifiers
      .map((m) => {
        const qty = m.qty > 0 && m.unitLabel ? ` ${m.qty} ${m.unitLabel}` : '';
        return `${m.name}${qty}`;
      })
      .join(', ');
    return mods ? `${item.qty}× ${item.name} — ${mods}` : `${item.qty}× ${item.name}`;
  });
}

export default function KioskKitchenScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venueId = status?.venue?.id ?? null;
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [shiftOpen, setShiftOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!session || !venueId) return;
    try {
      const data = await fetchKioskTickets(venueId, session.token);
      setTickets(data.tickets);
      setShiftOpen(data.shiftOpen);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки киоска');
    }
  }, [session, venueId]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, 4000);
      return () => clearInterval(id);
    }, [load])
  );

  const changeStatus = async (ticket: KioskTicket, next: KioskTicketStatus) => {
    if (!session || busyId) return;
    setBusyId(ticket.id);
    try {
      await setKioskTicketStatus(ticket.id, next, session.token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сменить статус');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScreenSwipeHost screen="Settings">
      <View style={styles.root}>
        {!shiftOpen ? (
          <Text style={styles.banner}>Смена закрыта — новые заявки киоск не принимает</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ScrollView horizontal contentContainerStyle={styles.board} showsHorizontalScrollIndicator={false}>
          {COLUMNS.map((col) => {
            const list = tickets.filter((t) => t.status === col.key);
            return (
              <View key={col.key} style={styles.column}>
                <View style={styles.colHead}>
                  <Text style={[styles.colTitle, { color: col.tint }]}>{col.title}</Text>
                  <Text style={styles.colCount}>{list.length}</Text>
                </View>
                <ScrollView contentContainerStyle={styles.colList}>
                  {list.map((ticket) => {
                    const next = NEXT[ticket.status];
                    return (
                      <View key={ticket.id} style={styles.card}>
                        <View style={styles.cardTop}>
                          <Text style={styles.number}>№ {ticket.number}</Text>
                          <Text style={styles.time}>{formatTime(ticket.createdAt)}</Text>
                        </View>
                        {modsText(ticket).map((line) => (
                          <Text key={line} style={styles.item}>
                            {line}
                          </Text>
                        ))}
                        <Text style={styles.total}>{Math.round(ticket.total)} ₽</Text>
                        <View style={styles.actions}>
                          {next ? (
                            <Pressable
                              style={styles.action}
                              disabled={busyId === ticket.id}
                              onPress={() => changeStatus(ticket, next.status)}
                            >
                              <Text style={styles.actionText}>{next.label}</Text>
                            </Pressable>
                          ) : null}
                          {ticket.status === 'new' || ticket.status === 'cooking' ? (
                            <Pressable
                              style={[styles.action, styles.actionGhost]}
                              disabled={busyId === ticket.id}
                              onPress={() => changeStatus(ticket, 'cancelled')}
                            >
                              <Text style={styles.actionGhostText}>Отмена</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                  {!list.length ? <Text style={styles.empty}>Пусто</Text> : null}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </ScreenSwipeHost>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  error: { color: colors.danger, textAlign: 'center', padding: 8 },
  board: { padding: 12, gap: 10, flexGrow: 1 },
  column: {
    width: 280,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  colHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colTitle: { fontSize: 15, fontWeight: '700' },
  colCount: { color: colors.textMuted, fontWeight: '700' },
  colList: { padding: 10, gap: 8, paddingBottom: 16 },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  number: { color: colors.text, fontSize: 20, fontWeight: '800' },
  time: { color: colors.textMuted, fontSize: 12 },
  item: { color: colors.text, fontSize: 13, lineHeight: 18 },
  total: { color: colors.accent2, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: {
    flex: 1,
    backgroundColor: colors.accent2,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontWeight: '700' },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  actionGhostText: { color: colors.danger, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 20 },
});
