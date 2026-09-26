import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import {
  formatModifierLine,
  guestStatusLabel,
  guestStatusTint,
  paymentMethodLabel,
  STAFF_FLOW,
} from '../kiosk/status';
import type { KioskTicket, KioskTicketStatus } from '../api/client';

type Props = {
  ticket: KioskTicket | null;
  busy?: boolean;
  onClose: () => void;
  onStatus: (status: KioskTicketStatus) => void;
  onReadyClose: () => void;
};

export default function KioskTicketDetailModal({ ticket, busy, onClose, onStatus, onReadyClose }: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReady, setConfirmReady] = useState(false);

  if (!ticket) return null;

  const canCancel = ticket.status === 'new' || ticket.status === 'cooking';
  const unpaid = ticket.paymentStatus !== 'paid';
  const payLabel = paymentMethodLabel(ticket.paymentMethod);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.box}>
          <View style={styles.top}>
            <View>
              <Text style={styles.kicker}>Самообслуживание{payLabel ? ` · ${payLabel}` : ''}</Text>
              <Text style={styles.number}>Заказ № {ticket.number}</Text>
            </View>
            <View style={[styles.badge, { borderColor: guestStatusTint(ticket.status) }]}>
              <Text style={[styles.badgeText, { color: guestStatusTint(ticket.status) }]}>
                {guestStatusLabel(ticket.status)}
              </Text>
            </View>
          </View>
          {unpaid ? (
            <Text style={styles.unpaid}>
              {ticket.paymentMethod === 'cash' ? 'Расчёт за наличные — оплата до выдачи' : 'Ожидает оплату'}
            </Text>
          ) : (
            <Text style={styles.paid}>Оплачено{payLabel ? ` · ${payLabel}` : ''}</Text>
          )}

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
            {ticket.items.map((item) => (
              <View key={item.id} style={styles.item}>
                <Text style={styles.itemName}>
                  {item.qty}× {item.name}
                </Text>
                <Text style={styles.itemPrice}>{Math.round(item.price * item.qty)} ₽</Text>
                {item.modifiers.length ? (
                  <View style={styles.mods}>
                    {item.modifiers.map((mod, idx) => (
                      <Text key={`${item.id}-${idx}`} style={styles.mod}>
                        · {formatModifierLine(mod)}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.modMuted}>без модификаторов</Text>
                )}
              </View>
            ))}
          </ScrollView>

          <Text style={styles.total}>
            {ticket.discountPercent
              ? `Итого ${Math.round(ticket.total)} ₽ · скидка ${ticket.discountPercent}%`
              : `Итого ${Math.round(ticket.total)} ₽`}
          </Text>
          <Text style={styles.flowLabel}>Статус</Text>
          <View style={styles.flow}>
            {STAFF_FLOW.map((step) => {
              const active = ticket.status === step.key || (step.key === 'ready' && ticket.status === 'issued');
              const isReady = step.key === 'ready';
              return (
                <Pressable
                  key={step.key}
                  style={[styles.flowBtn, active && styles.flowBtnOn]}
                  disabled={busy || (active && !isReady)}
                  onPress={() => {
                    if (isReady) setConfirmReady(true);
                    else onStatus(step.key);
                  }}
                >
                  <Text style={[styles.flowText, active && styles.flowTextOn]}>{step.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {confirmReady ? (
            <Pressable
              style={styles.readySure}
              disabled={busy}
              onPress={() => {
                setConfirmReady(false);
                onReadyClose();
              }}
            >
              <Text style={styles.readySureText}>
                {unpaid
                  ? 'Подтвердить готовность — сначала оплата, затем выдача'
                  : 'Подтвердить готовность и выдачу, закрыть заказ'}
              </Text>
            </Pressable>
          ) : null}

          {canCancel ? (
            confirmCancel ? (
              <Pressable
                style={styles.cancelSure}
                disabled={busy}
                onPress={() => {
                  onStatus('cancelled');
                  setConfirmCancel(false);
                }}
              >
                <Text style={styles.cancelSureText}>Точно отменить заказ?</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.cancel} onPress={() => setConfirmCancel(true)}>
                <Text style={styles.cancelText}>Отменить</Text>
              </Pressable>
            )
          ) : null}

          <Pressable style={styles.close} onPress={onClose}>
            {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.closeText}>Закрыть</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  box: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    zIndex: 1,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  kicker: {
    color: '#f0c14b',
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  number: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 2 },
  badge: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontWeight: '800', fontSize: 13 },
  unpaid: { color: '#f0c14b', fontWeight: '800', marginTop: 8 },
  paid: { color: '#86efac', fontWeight: '700', marginTop: 8 },
  list: { marginTop: 14, flexGrow: 0 },
  listInner: { gap: 10, paddingBottom: 8 },
  item: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: 12,
  },
  itemName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  itemPrice: { color: colors.accent2, fontWeight: '700', marginTop: 2 },
  mods: { marginTop: 8, gap: 3 },
  mod: { color: colors.text, fontSize: 14, lineHeight: 20 },
  modMuted: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  total: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 12 },
  flowLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  flow: { flexDirection: 'row', gap: 8 },
  flowBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  flowBtnOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  flowText: { color: colors.text, fontWeight: '800', fontSize: 12, textAlign: 'center' },
  flowTextOn: { color: '#fff' },
  readySure: {
    marginTop: 10,
    backgroundColor: '#14532d',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  readySureText: { color: '#bbf7d0', fontWeight: '800', textAlign: 'center', paddingHorizontal: 8 },
  cancel: { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: colors.danger, fontWeight: '700' },
  cancelSure: {
    marginTop: 10,
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelSureText: { color: '#fff', fontWeight: '800' },
  close: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.text, fontWeight: '700' },
});
