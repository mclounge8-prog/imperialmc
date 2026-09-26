import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kk } from '../kiosk/theme';
import type { MenuItem } from '../api/client';

export type CheckoutCartLine = {
  key: string;
  item: MenuItem;
  modifierIds: number[];
  unitPrice: number;
  qty: number;
};

type PayStep = 'type' | 'offer' | 'cashless' | 'qr';

type Props = {
  cart: CheckoutCartLine[];
  total: number;
  discountPct: number;
  qrUrl: string | null;
  step: PayStep;
  busy?: boolean;
  error?: string | null;
  onBack: () => void;
  onCash: () => void;
  onCashless: () => void;
  onAcceptOffer: () => void;
  onThinkLater: () => void;
  onCard: () => void;
  onOpenQr: () => void;
  onConfirmQr: () => void;
};

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function extrasOf(item: MenuItem, ids: number[]): { name: string; price: number }[] {
  const set = new Set(ids);
  return item.modifierGroups.flatMap((g) =>
    g.options.filter((o) => set.has(o.modifierId)).map((o) => ({ name: o.name, price: o.price }))
  );
}

function titleFor(step: PayStep, discountPct: number): string {
  if (step === 'offer') return 'Уникальное предложение';
  if (step === 'cashless') return 'Безналичная оплата';
  if (step === 'qr') return `Оплата по QR · скидка ${discountPct}%`;
  return 'Выбор способа оплаты';
}

function MethodCard({
  emoji,
  title,
  sub,
  badge,
  tint,
  glow,
  disabled,
  onPress,
}: {
  emoji: string;
  title: string;
  sub: string;
  badge?: string;
  tint: string[];
  glow: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <LinearGradient colors={tint} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.method, { borderColor: glow }]}>
        <View style={[styles.methodIcon, { backgroundColor: `${glow}22`, borderColor: glow }]}>
          <Text style={styles.methodEmoji}>{emoji}</Text>
        </View>
        <View style={styles.methodCopy}>
          <View style={styles.methodTitleRow}>
            <Text style={styles.methodTitle}>{title}</Text>
            {badge ? (
              <View style={[styles.badge, { backgroundColor: glow }]}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.methodSub}>{sub}</Text>
        </View>
        <Text style={[styles.methodArrow, { color: glow }]}>›</Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function KioskCheckoutPanel({
  cart,
  total,
  discountPct,
  qrUrl,
  step,
  busy,
  error,
  onBack,
  onCash,
  onCashless,
  onAcceptOffer,
  onThinkLater,
  onCard,
  onOpenQr,
  onConfirmQr,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const qrSize = wide ? 260 : Math.min(220, Math.max(168, Math.round(height * 0.24)));
  const qrOff = roundMoney((total * discountPct) / 100);
  const qrPayable = roundMoney(total - qrOff);
  const showQrPrice = step === 'qr' && discountPct > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.head}>
        <Pressable style={styles.back} onPress={onBack}>
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <Text style={styles.title}>{titleFor(step, discountPct)}</Text>
        <View style={styles.headSpacer} />
      </View>

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={[styles.receiptCard, wide && styles.receiptWide]}>
          <Text style={styles.receiptEyebrow}>Ваш заказ</Text>
          <Text style={styles.receiptLead}>Проверь состав и цены до оплаты</Text>
          <ScrollView style={styles.receiptList} contentContainerStyle={styles.receiptListInner} showsVerticalScrollIndicator={false}>
            {cart.map((line) => {
              const extras = extrasOf(line.item, line.modifierIds);
              const lineTotal = line.unitPrice * line.qty;
              return (
                <View key={line.key} style={styles.line}>
                  <View style={styles.lineTop}>
                    <Text style={styles.lineName}>{line.item.name}</Text>
                    <Text style={styles.lineSum}>{money(lineTotal)}</Text>
                  </View>
                  <Text style={styles.lineQty}>
                    {line.qty} × {money(line.item.price)}
                  </Text>
                  {extras.map((extra, idx) => {
                    const extraTotal = extra.price * line.qty;
                    return (
                      <View key={`${line.key}-${idx}`} style={styles.extraRow}>
                        <Text style={styles.extraName}>+ {extra.name}</Text>
                        <Text style={[styles.extraPrice, extraTotal > 0 && styles.extraPaid]}>
                          {extraTotal > 0 ? `+${money(extraTotal)}` : 'включено'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.totalBox}>
            {showQrPrice ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalMuted}>Сумма</Text>
                  <Text style={styles.totalMuted}>{money(total)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.discountLabel}>Скидка {discountPct}% за QR</Text>
                  <Text style={styles.discountLabel}>−{money(qrOff)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>К оплате</Text>
                  <Text style={styles.totalValue}>{money(qrPayable)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Итого</Text>
                <Text style={styles.totalValue}>{money(total)}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={[styles.payCol, wide && styles.payWide]}>
          {step === 'type' ? (
            <>
              <MethodCard
                emoji="💵"
                title="Наличные"
                sub="Оплата сотруднику при выдаче"
                tint={['#173322', '#141816']}
                glow="#4ade80"
                disabled={busy}
                onPress={onCash}
              />
              <MethodCard
                emoji="💳"
                title="Безналичные"
                sub="Карта на стойке или перевод по QR"
                tint={['#18233f', '#14161c']}
                glow="#60a5fa"
                disabled={busy}
                onPress={onCashless}
              />
            </>
          ) : null}

          {step === 'cashless' ? (
            <>
              <MethodCard
                emoji="💳"
                title="Карта"
                sub="Оплата у сотрудника · без скидки"
                tint={['#18233f', '#14161c']}
                glow="#60a5fa"
                disabled={busy}
                onPress={onCard}
              />
              <MethodCard
                emoji="▣"
                title="QR-код"
                sub="Перевод по QR · покажи скрин сотруднику"
                badge={discountPct > 0 ? `−${discountPct}%` : undefined}
                tint={['#3a2a0c', '#1a160e']}
                glow="#fbbf24"
                disabled={busy}
                onPress={onOpenQr}
              />
            </>
          ) : null}

          {step === 'qr' ? (
            <View style={styles.qrCard}>
              {qrUrl ? (
                <FastImage
                  source={{ uri: qrUrl }}
                  style={[styles.qr, { width: qrSize, height: qrSize }]}
                  resizeMode={FastImage.resizeMode.contain}
                />
              ) : (
                <Text style={styles.qrMissing}>QR для этой точки ещё не загружен в бэкофисе</Text>
              )}
              <Text style={styles.qrHint}>
                Оплати {money(qrPayable)}, покажи скрин сотруднику и нажми «Я оплатил».
              </Text>
              <Pressable
                style={[styles.confirm, (!qrUrl || busy) && styles.confirmOff]}
                disabled={busy || !qrUrl}
                onPress={onConfirmQr}
              >
                {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.confirmText}>Я оплатил</Text>}
              </Pressable>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy && step !== 'qr' ? <ActivityIndicator color={kk.gold} style={{ marginTop: 12 }} /> : null}
        </View>
      </View>

      {step === 'offer' ? (
        <Pressable style={styles.offerWrap} onPress={onBack}>
          <Pressable style={styles.offerCard} onPress={(e) => e.stopPropagation()}>
            <LinearGradient
              colors={['#4a3410', '#2a1e0c', '#16140f']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.offerInner}
            >
              <View style={styles.offerBadge}>
                <Text style={styles.offerBadgeText}>Уникальное предложение</Text>
              </View>
              <Text style={styles.offerKicker}>Оплата переводом по QR</Text>
              <Text style={styles.offerHero}>−{discountPct}%</Text>
              <Text style={styles.offerSave}>выгода {money(qrOff)}</Text>
              <Text style={styles.offerCopy}>
                Если оплатите заказ переводом по QR-коду, вы поможете нам становиться лучше — и получите скидку{' '}
                {discountPct}% на этот заказ. К оплате {money(qrPayable)} вместо {money(total)}.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.offerCta, pressed && styles.pressed]}
                disabled={busy}
                onPress={onAcceptOffer}
              >
                <Text style={styles.offerCtaText}>Воспользоваться предложением</Text>
              </Pressable>
              <Pressable style={styles.offerLater} disabled={busy} onPress={onThinkLater}>
                <Text style={styles.offerLaterText}>Я подумаю</Text>
              </Pressable>
            </LinearGradient>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: kk.bg,
    paddingHorizontal: 20,
    zIndex: 22,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  back: {
    borderWidth: 1,
    borderColor: '#2a3144',
    backgroundColor: '#171b24',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backText: { color: kk.cream, fontSize: 17, fontWeight: '800' },
  title: {
    flex: 1,
    color: kk.cream,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  headSpacer: { width: 108 },
  body: { flex: 1, gap: 16 },
  bodyWide: { flexDirection: 'row', alignItems: 'stretch' },
  receiptCard: {
    flex: 1,
    backgroundColor: '#161a22',
    borderWidth: 1,
    borderColor: '#2a3144',
    borderRadius: 28,
    padding: 20,
  },
  receiptWide: { maxWidth: '48%' },
  receiptEyebrow: {
    color: '#93c5fd',
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: 13,
  },
  receiptLead: { color: kk.muted, marginTop: 4, marginBottom: 14, fontSize: 16 },
  receiptList: { flex: 1 },
  receiptListInner: { paddingBottom: 8 },
  line: {
    borderBottomWidth: 1,
    borderBottomColor: '#262c3a',
    paddingBottom: 12,
    marginBottom: 12,
  },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineName: { color: kk.cream, fontSize: 20, fontWeight: '800', flex: 1 },
  lineSum: { color: kk.cream, fontSize: 20, fontWeight: '800' },
  lineQty: { color: kk.muted, marginTop: 4, fontWeight: '700' },
  extraRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 12 },
  extraName: { color: '#c7d2fe', fontSize: 15, flex: 1 },
  extraPrice: { color: kk.muted, fontWeight: '700' },
  extraPaid: { color: '#fbbf24' },
  totalBox: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
    marginTop: 4,
    gap: 8,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalMuted: { color: kk.muted, fontSize: 16, fontWeight: '700' },
  discountLabel: { color: '#fbbf24', fontSize: 16, fontWeight: '800' },
  totalLabel: { color: kk.cream, fontSize: 22, fontWeight: '800' },
  totalValue: { color: '#fff', fontSize: 30, fontWeight: '800' },
  payCol: { gap: 14 },
  payWide: { flex: 1, justifyContent: 'center' },
  method: {
    minHeight: 118,
    borderRadius: 24,
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
  methodIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodEmoji: { fontSize: 34 },
  methodCopy: { flex: 1, gap: 4 },
  methodTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  methodTitle: { color: kk.cream, fontSize: 26, fontWeight: '800' },
  methodSub: { color: kk.muted, fontSize: 16, lineHeight: 22 },
  methodArrow: { fontSize: 42, fontWeight: '300', marginTop: -4 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#111', fontWeight: '800', fontSize: 13 },
  qrCard: {
    backgroundColor: '#161a22',
    borderWidth: 1,
    borderColor: '#2a3144',
    borderRadius: 28,
    padding: 20,
    alignItems: 'center',
    gap: 16,
  },
  qr: { backgroundColor: '#fff', borderRadius: 20 },
  qrMissing: { color: kk.cream, textAlign: 'center', fontSize: 18, padding: 20 },
  qrHint: { color: kk.cream, fontSize: 18, textAlign: 'center', lineHeight: 26 },
  confirm: {
    alignSelf: 'stretch',
    backgroundColor: '#fbbf24',
    minHeight: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: '#111', fontSize: 24, fontWeight: '800' },
  error: { color: kk.red, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  offerWrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(6, 8, 12, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 30,
  },
  offerCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#fbbf24',
    overflow: 'hidden',
    shadowColor: '#fbbf24',
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  offerInner: {
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
  },
  offerBadge: {
    backgroundColor: '#fbbf24',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 6,
  },
  offerBadgeText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  offerKicker: { color: '#fde68a', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  offerHero: { color: '#fbbf24', fontSize: 72, fontWeight: '800', lineHeight: 78 },
  offerSave: { color: '#fff', fontSize: 22, fontWeight: '800' },
  offerCopy: {
    color: '#e7e5e4',
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  offerCta: {
    alignSelf: 'stretch',
    backgroundColor: '#fbbf24',
    minHeight: 76,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  offerCtaText: { color: '#111', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  offerLater: { paddingVertical: 14, paddingHorizontal: 18 },
  offerLaterText: { color: '#d6d3d1', fontSize: 18, fontWeight: '700' },
});
