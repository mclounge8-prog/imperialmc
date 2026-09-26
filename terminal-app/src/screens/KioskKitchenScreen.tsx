import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import { fetchKioskTickets, setKioskTicketStatus, closeKioskTicket, payGuest } from '../api/client';
import type { KioskTicket, KioskTicketStatus } from '../api/client';
import ScreenSwipeHost from '../components/ScreenSwipeHost';
import KioskTicketDetailModal from '../components/KioskTicketDetailModal';
import StaffPaymentModal from '../components/StaffPaymentModal';
import { formatModifierLine, paymentMethodLabel } from '../kiosk/status';
import { runPendingFiscalJobs } from '../services/fiscalWorker';

const COLUMNS: { key: KioskTicketStatus; title: string; tint: string }[] = [
  { key: 'new', title: 'Оформлен', tint: '#8aa4ff' },
  { key: 'cooking', title: 'Изготавливается', tint: '#f0c14b' },
  { key: 'ready', title: 'Готов', tint: '#6ee7a8' },
];

function formatTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function KioskKitchenScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venueId = status?.venue?.id ?? null;
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [shiftOpen, setShiftOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [payTicket, setPayTicket] = useState<KioskTicket | null>(null);

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

  const openTicket = tickets.find((t) => t.id === openId) ?? null;

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
                  {list.map((ticket) => (
                    <Pressable key={ticket.id} style={styles.card} onPress={() => setOpenId(ticket.id)}>
                        <View style={styles.cardTop}>
                          <Text style={styles.number}>№ {ticket.number}</Text>
                          <Text style={styles.time}>{formatTime(ticket.createdAt)}</Text>
                        </View>
                        {ticket.paymentMethod ? (
                          <Text style={styles.payHint}>
                            {paymentMethodLabel(ticket.paymentMethod)}
                            {ticket.paymentStatus !== 'paid' ? ' · ждёт оплату' : ''}
                          </Text>
                        ) : null}
                      {ticket.items.map((item) => (
                        <View key={item.id} style={styles.itemBlock}>
                          <Text style={styles.item}>
                            {item.qty}× {item.name}
                          </Text>
                          {item.modifiers.map((mod, idx) => (
                            <Text key={`${item.id}-${idx}`} style={styles.mod}>
                              {formatModifierLine(mod)}
                            </Text>
                          ))}
                        </View>
                      ))}
                      <Text style={styles.total}>{Math.round(ticket.total)} ₽</Text>
                      <Text style={styles.openHint}>Открыть полностью</Text>
                    </Pressable>
                  ))}
                  {!list.length ? <Text style={styles.empty}>Пусто</Text> : null}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
        <KioskTicketDetailModal
          ticket={openTicket}
          busy={busyId === openTicket?.id}
          onClose={() => setOpenId(null)}
          onStatus={(next) => {
            if (openTicket) void changeStatus(openTicket, next);
          }}
          onReadyClose={() => {
            if (!openTicket || !session) return;
            if (
              openTicket.paymentStatus !== 'paid' &&
              (openTicket.paymentMethod === 'cash' || openTicket.paymentMethod === 'card')
            ) {
              setPayTicket(openTicket);
              return;
            }
            void changeStatus(openTicket, 'issued');
          }}
        />
        <StaffPaymentModal
          visible={payTicket != null}
          method={payTicket?.paymentMethod === 'card' ? 'card' : 'cash'}
          amount={payTicket?.total ?? 0}
          subtotal={payTicket?.subtotal}
          discountPercent={payTicket?.discountPercent}
          busy={busyId === payTicket?.id}
          onClose={() => setPayTicket(null)}
          onConfirm={async (method) => {
            if (!session || !payTicket?.orderId || !payTicket.guestId || !venueId) return;
            setBusyId(payTicket.id);
            try {
              await payGuest(payTicket.orderId, payTicket.guestId, method, payTicket.total, session.token);
              await closeKioskTicket(payTicket.id, session.token);
              runPendingFiscalJobs(venueId, session.token);
              setPayTicket(null);
              setOpenId(null);
              await load();
            } finally {
              setBusyId(null);
            }
          }}
        />
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
    width: 300,
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
  itemBlock: { marginTop: 4 },
  item: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  mod: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginLeft: 8 },
  total: { color: colors.accent2, fontWeight: '700', marginTop: 4 },
  openHint: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  payHint: { color: '#f0c14b', fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 20 },
});
