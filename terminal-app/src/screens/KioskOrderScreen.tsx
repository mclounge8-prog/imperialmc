import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';
import { VenueSecretTitle } from '../kiosk/KioskChrome';
import { guestStatusLabel, guestStatusTint } from '../kiosk/status';
import KioskCustomizePanel from '../components/KioskCustomizePanel';
import KioskReadyBanner from '../components/KioskReadyBanner';
import {
  API_BASE_URL,
  createKioskTicket,
  fetchKioskBootstrap,
  fetchKioskMenu,
  fetchMyKioskTickets,
} from '../api/client';
import type { KioskBootstrap, KioskPaymentMethod, KioskTicket, MenuCategory, MenuItem } from '../api/client';

type CartLine = {
  key: string;
  item: MenuItem;
  modifierIds: number[];
  unitPrice: number;
  qty: number;
};

type PayStep = null | 'type' | 'cashless' | 'qr';

function flattenCats(cats: MenuCategory[], acc: MenuCategory[] = []): MenuCategory[] {
  for (const cat of cats) {
    acc.push(cat);
    flattenCats(cat.children || [], acc);
  }
  return acc;
}

function defaultIds(item: MenuItem): number[] {
  return item.modifierGroups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.modifierId));
}

function linePrice(item: MenuItem, ids: number[]): number {
  const set = new Set(ids);
  return (
    item.price +
    item.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => set.has(o.modifierId))
      .reduce((sum, o) => sum + o.price, 0)
  );
}

function lineMods(item: MenuItem, ids: number[]): string {
  const set = new Set(ids);
  return item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => set.has(o.modifierId))
    .map((o) => o.name)
    .join(', ');
}

function needsCustomize(item: MenuItem): boolean {
  return item.modifierGroups.some((g) => g.options.length > 0);
}

function waitReason(boot: KioskBootstrap | null): string {
  if (!boot) return 'Проверяю устройство…';
  if (!boot.active) return 'Устройство деактивировано в бэкофисе';
  if (boot.kind !== 'kiosk') return 'Тип устройства — не киоск. В бэкофисе поставь тип «Киоск».';
  if (!boot.venue) return 'Назначь заведение этому устройству в бэкофисе';
  if (!boot.venue.kioskEnabled) {
    return `На заведении «${boot.venue.name}» киоск выключен — включи чекбокс на карточке заведения.`;
  }
  if (!boot.shiftOpen) return 'Смена закрыта. Открой смену в приложении терминала на этом же планшете.';
  return 'Готово';
}

export default function KioskOrderScreen() {
  const { deviceToken, status, refresh } = useDevice();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 860;

  const [boot, setBoot] = useState<KioskBootstrap | null>(null);
  const [menu, setMenu] = useState<{ categories: MenuCategory[]; uncategorized: MenuItem[] } | null>(null);
  const [categoryId, setCategoryId] = useState<number | 'uncat' | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastLine, setLastLine] = useState<CartLine | null>(null);
  const [customize, setCustomize] = useState<MenuItem | null>(null);
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [ordering, setOrdering] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [payStep, setPayStep] = useState<PayStep>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const lastTouch = useRef(Date.now());
  const idlePromptAt = useRef<number | null>(null);

  const bumpActivity = useCallback(() => {
    lastTouch.current = Date.now();
    if (!idlePrompt) idlePromptAt.current = null;
  }, [idlePrompt]);

  const resetToHome = useCallback(() => {
    setCart([]);
    setLastLine(null);
    setCustomize(null);
    setCartOpen(false);
    setPayStep(null);
    setIdlePrompt(false);
    setOrdering(false);
    idlePromptAt.current = null;
    lastTouch.current = Date.now();
  }, []);

  const loadBoot = useCallback(async () => {
    if (!deviceToken) return;
    try {
      const next = await fetchKioskBootstrap(deviceToken);
      setBoot(next);
      setError(null);
      if (next.ready) {
        const [data, mine] = await Promise.all([fetchKioskMenu(deviceToken), fetchMyKioskTickets(deviceToken)]);
        setMenu(data);
        setTickets(mine.tickets);
        setCategoryId((prev) => {
          if (prev != null) return prev;
          return data.categories[0]?.id ?? (data.uncategorized.length ? 'uncat' : null);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось связаться с сервером');
    }
  }, [deviceToken]);

  useEffect(() => {
    loadBoot();
    const id = setInterval(loadBoot, 4000);
    return () => clearInterval(id);
  }, [loadBoot]);

  useEffect(() => {
    if (!ordering) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (idlePrompt) {
        if (idlePromptAt.current && now - idlePromptAt.current >= 15000) resetToHome();
        return;
      }
      if (now - lastTouch.current >= 50000) {
        setIdlePrompt(true);
        idlePromptAt.current = now;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [ordering, idlePrompt, resetToHome]);

  const cats = useMemo(() => flattenCats(menu?.categories || []), [menu]);
  const items = useMemo(() => {
    if (!menu || categoryId == null) return [];
    if (categoryId === 'uncat') return menu.uncategorized;
    const found = cats.find((c) => c.id === categoryId);
    if (!found) return [];
    return [...found.items, ...(found.children || []).flatMap((c) => c.items)];
  }, [menu, categoryId, cats]);

  const addLine = (item: MenuItem, modifierIds: number[]) => {
    bumpActivity();
    const key = `${item.id}:${[...modifierIds].sort().join(',')}`;
    const unit = linePrice(item, modifierIds);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      const next = existing
        ? prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
        : [...prev, { key, item, modifierIds, unitPrice: unit, qty: 1 }];
      const line = next.find((l) => l.key === key) || null;
      setLastLine(line);
      return next;
    });
    setCustomize(null);
  };

  const changeQty = (key: string, delta: number) => {
    bumpActivity();
    setCart((prev) => {
      const next = prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
      setLastLine((cur) => {
        if (!cur || cur.key !== key) return cur;
        return next.find((l) => l.key === key) ?? null;
      });
      return next;
    });
  };

  const submit = async (method: KioskPaymentMethod) => {
    if (!deviceToken || !cart.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await createKioskTicket(
        deviceToken,
        cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, modifierIds: l.modifierIds })),
        method
      );
      resetToHome();
      setFlash(`Заказ № ${data.ticket.number} оформлен`);
      setTimeout(() => setFlash(null), 4000);
      await loadBoot();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось оформить');
    } finally {
      setBusy(false);
    }
  };

  const total = cart.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);
  const cols = width >= 1200 ? 3 : 2;
  const gridPad = 16;
  const gap = 12;
  const sideCats = wide && ordering ? 220 : 0;
  const tileW = Math.max(160, (width - sideCats - gridPad * 2 - gap * (cols - 1)) / cols);
  const venueName = boot?.venue?.name || status?.venue?.name || 'Киоск';
  const visibleTickets = tickets.filter((t) => t.status !== 'cancelled');
  const discountPct = Number(boot?.venue?.cashlessDiscountPercent ?? 12);
  const qrUrl = boot?.venue?.qrImageUrl ? `${API_BASE_URL}${boot.venue.qrImageUrl}` : null;

  const header = (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
      <VenueSecretTitle name={venueName} style={styles.venue} />
      <Text style={styles.topHint}>Самообслуживание</Text>
    </View>
  );

  if (!boot?.ready) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerBody}>
          <Text style={styles.eyebrow}>Киоск</Text>
          <Text style={styles.heroTitle}>Ожидание</Text>
          <Text style={styles.wait}>{waitReason(boot)}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.ghost} onPress={() => refresh()}>
            <Text style={styles.ghostText}>Обновить</Text>
          </Pressable>
        </View>
        <KioskReadyBanner tickets={tickets} />
      </View>
    );
  }

  if (!ordering) {
    return (
      <View style={styles.root}>
        {header}
        <ScrollView contentContainerStyle={styles.homeBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.welcome}>Добро пожаловать</Text>
          <Text style={styles.homeLead}>Выбери блюда на экране. Способ оплаты — в конце оформления.</Text>
          <Pressable style={styles.makeOrder} onPress={() => { bumpActivity(); setOrdering(true); }}>
            <Text style={styles.makeOrderText}>Сделать заказ</Text>
          </Pressable>
          {flash ? <Text style={styles.flash}>{flash}</Text> : null}
          <Text style={styles.section}>Статусы заказов</Text>
          {!visibleTickets.length ? (
            <Text style={styles.empty}>Пока нет заказов с этого киоска</Text>
          ) : (
            visibleTickets.map((ticket) => (
              <View
                key={ticket.id}
                style={[styles.ticketRow, ticket.status === 'ready' && styles.ticketRowReady]}
              >
                <Text style={styles.ticketNum}>№ {ticket.number}</Text>
                <Text style={[styles.ticketStatus, { color: guestStatusTint(ticket.status) }]}>
                  {guestStatusLabel(ticket.status)}
                </Text>
                <Text style={styles.ticketSum}>{Math.round(ticket.total)} ₽</Text>
              </View>
            ))
          )}
        </ScrollView>
        <KioskReadyBanner tickets={tickets} />
      </View>
    );
  }

  const catTiles = (
    <>
      {cats.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.catTile, categoryId === c.id && styles.catTileOn]}
          onPress={() => {
            bumpActivity();
            setCategoryId(c.id);
          }}
        >
          <Text style={[styles.catTileText, categoryId === c.id && styles.catTileTextOn]}>{c.name}</Text>
        </Pressable>
      ))}
      {menu?.uncategorized.length ? (
        <Pressable
          style={[styles.catTile, categoryId === 'uncat' && styles.catTileOn]}
          onPress={() => {
            bumpActivity();
            setCategoryId('uncat');
          }}
        >
          <Text style={[styles.catTileText, categoryId === 'uncat' && styles.catTileTextOn]}>Ещё</Text>
        </Pressable>
      ) : null}
    </>
  );

  return (
    <View style={styles.root} onTouchStart={bumpActivity}>
      {header}
      <View style={styles.menuBar}>
        <Pressable
          style={styles.back}
          onPress={() => {
            resetToHome();
          }}
        >
          <Text style={styles.backText}>← К статусам</Text>
        </Pressable>
        <Pressable
          style={styles.cartChip}
          onPress={() => {
            bumpActivity();
            setCartOpen(true);
          }}
        >
          <Text style={styles.cartChipText}>
            Корзина {cartCount ? `· ${cartCount}` : ''} {total ? `· ${Math.round(total)} ₽` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.menuShell, !wide && styles.menuShellCol]}>
        {wide ? (
          <ScrollView style={styles.catCol} contentContainerStyle={styles.catColInner}>
            {catTiles}
          </ScrollView>
        ) : (
          <View style={styles.catWrap}>{catTiles}</View>
        )}
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.tile, { width: tileW }]}
              onPress={() => {
                bumpActivity();
                if (needsCustomize(item)) setCustomize(item);
                else addLine(item, defaultIds(item));
              }}
            >
              {item.imageUrl ? (
                <FastImage
                  source={{ uri: `${API_BASE_URL}${item.imageUrl}`, cache: FastImage.cacheControl.immutable }}
                  style={styles.pic}
                />
              ) : (
                <View style={[styles.pic, styles.picEmpty]}>
                  <Text style={styles.picHint}>🍽</Text>
                </View>
              )}
              <Text style={styles.itemName} numberOfLines={3}>
                {item.name}
              </Text>
              <Text style={styles.price}>{Math.round(item.price)} ₽</Text>
            </Pressable>
          )}
        />
      </View>

      {lastLine ? (
        <View style={[styles.lastBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.lastInfo}>
            <Text style={styles.lastName} numberOfLines={1}>
              {lastLine.item.name}
            </Text>
            <Text style={styles.lastMeta}>
              {Math.round(lastLine.unitPrice * lastLine.qty)} ₽
              {lineMods(lastLine.item, lastLine.modifierIds) ? ` · ${lineMods(lastLine.item, lastLine.modifierIds)}` : ''}
            </Text>
          </View>
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyBtn} onPress={() => changeQty(lastLine.key, -1)}>
              <Text style={styles.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={styles.qtyVal}>{lastLine.qty}</Text>
            <Pressable style={styles.qtyBtn} onPress={() => changeQty(lastLine.key, 1)}>
              <Text style={styles.qtyBtnText}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {cartOpen ? (
        <View style={[styles.fullOverlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.overlayTitle}>Корзина</Text>
          <ScrollView style={styles.cartList}>
            {!cart.length ? <Text style={styles.empty}>Пока пусто — нажми на блюдо</Text> : null}
            {cart.map((line) => (
              <View key={line.key} style={styles.cartLine}>
                <View style={styles.cartTop}>
                  <Text style={styles.cartName}>{line.item.name}</Text>
                  <Text style={styles.cartName}>{Math.round(line.unitPrice * line.qty)} ₽</Text>
                </View>
                {lineMods(line.item, line.modifierIds) ? (
                  <Text style={styles.mods}>{lineMods(line.item, line.modifierIds)}</Text>
                ) : null}
                <View style={styles.qtyRow}>
                  <Pressable style={styles.qtyBtn} onPress={() => changeQty(line.key, -1)}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyVal}>{line.qty}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => changeQty(line.key, 1)}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.makeOrder, styles.submit]}
            disabled={!cart.length}
            onPress={() => {
              bumpActivity();
              setCartOpen(false);
              setPayStep('type');
            }}
          >
            <Text style={styles.makeOrderText}>Оформить · {Math.round(total)} ₽</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={() => setCartOpen(false)}>
            <Text style={styles.ghostText}>Назад к меню</Text>
          </Pressable>
        </View>
      ) : null}

      {payStep ? (
        <View style={[styles.fullOverlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          {payStep === 'type' ? (
            <>
              <Text style={styles.overlayTitle}>Как будешь платить?</Text>
              <View style={styles.payTiles}>
                <Pressable style={styles.payTile} disabled={busy} onPress={() => void submit('cash')}>
                  <Text style={styles.payEmoji}>💵</Text>
                  <Text style={styles.payTileTitle}>Наличные</Text>
                  <Text style={styles.payTileSub}>Оплата у сотрудника при выдаче</Text>
                </Pressable>
                <Pressable
                  style={styles.payTile}
                  disabled={busy}
                  onPress={() => {
                    bumpActivity();
                    setPayStep('cashless');
                  }}
                >
                  <Text style={styles.payEmoji}>💳</Text>
                  <Text style={styles.payTileTitle}>Безналичные</Text>
                  <Text style={styles.payTileSub}>Скидка {discountPct}%</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {payStep === 'cashless' ? (
            <>
              <Text style={styles.overlayTitle}>Безнал · скидка {discountPct}%</Text>
              <View style={styles.payTiles}>
                <Pressable style={styles.payTile} disabled={busy} onPress={() => void submit('card')}>
                  <Text style={styles.payEmoji}>💳</Text>
                  <Text style={styles.payTileTitle}>Карта</Text>
                  <Text style={styles.payTileSub}>Оплата у сотрудника</Text>
                </Pressable>
                <Pressable
                  style={styles.payTile}
                  disabled={busy}
                  onPress={() => {
                    bumpActivity();
                    setPayStep('qr');
                  }}
                >
                  <Text style={styles.payEmoji}>▣</Text>
                  <Text style={styles.payTileTitle}>QR-код</Text>
                  <Text style={styles.payTileSub}>Скидка {discountPct}%</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {payStep === 'qr' ? (
            <>
              <Text style={styles.overlayTitle}>Оплата по QR</Text>
              {qrUrl ? (
                <FastImage source={{ uri: qrUrl }} style={styles.qr} resizeMode={FastImage.resizeMode.contain} />
              ) : (
                <Text style={styles.wait}>QR для этой точки ещё не загружен в бэкофисе</Text>
              )}
              <Text style={styles.qrHint}>
                При подтверждении оплаты покажите перевод сотруднику
              </Text>
              <Pressable style={[styles.makeOrder, styles.submit]} disabled={busy || !qrUrl} onPress={() => void submit('qr')}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.makeOrderText}>Я оплатил</Text>}
              </Pressable>
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy && payStep !== 'qr' ? <ActivityIndicator color={colors.accent2} /> : null}
          <Pressable
            style={styles.ghost}
            onPress={() => {
              bumpActivity();
              setPayStep(payStep === 'type' ? null : payStep === 'qr' ? 'cashless' : 'type');
            }}
          >
            <Text style={styles.ghostText}>Назад</Text>
          </Pressable>
        </View>
      ) : null}

      {idlePrompt ? (
        <View style={styles.idleWrap}>
          <View style={styles.idleCard}>
            <Text style={styles.overlayTitle}>Очистить корзину?</Text>
            <Text style={styles.homeLead}>Нет действий 50 секунд. Вернуться на главный экран?</Text>
            <Pressable style={styles.makeOrder} onPress={resetToHome}>
              <Text style={styles.makeOrderText}>Да</Text>
            </Pressable>
            <Pressable
              style={styles.ghost}
              onPress={() => {
                setIdlePrompt(false);
                idlePromptAt.current = null;
                bumpActivity();
              }}
            >
              <Text style={styles.ghostText}>Нет</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {customize ? (
        <KioskCustomizePanel
          item={customize}
          onClose={() => setCustomize(null)}
          onConfirm={(ids) => addLine(customize, ids)}
        />
      ) : null}
      <KioskReadyBanner tickets={tickets} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  venue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  topHint: { color: colors.textMuted, fontWeight: '700' },
  eyebrow: { color: colors.accent2, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { color: colors.text, fontSize: 36, fontWeight: '800' },
  wait: {
    color: colors.text,
    backgroundColor: colors.surface2,
    padding: 16,
    borderRadius: 12,
    textAlign: 'center',
    maxWidth: 460,
    fontSize: 16,
  },
  welcome: { color: colors.text, fontSize: 42, fontWeight: '800', textAlign: 'center' },
  homeLead: { color: colors.textMuted, fontSize: 18, textAlign: 'center', maxWidth: 520, lineHeight: 26 },
  homeBody: { padding: 24, alignItems: 'center', gap: 16, paddingBottom: 40 },
  makeOrder: {
    backgroundColor: colors.accent2,
    borderRadius: 22,
    minHeight: 84,
    minWidth: 280,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  makeOrderText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  flash: { color: '#86efac', fontSize: 18, fontWeight: '800' },
  section: {
    alignSelf: 'stretch',
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 12,
  },
  empty: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
  ticketRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  ticketRowReady: { borderColor: '#4ade80', backgroundColor: '#14532d' },
  ticketNum: { color: colors.text, fontSize: 24, fontWeight: '800', minWidth: 90 },
  ticketStatus: { flex: 1, fontSize: 20, fontWeight: '800' },
  ticketSum: { color: colors.text, fontSize: 18, fontWeight: '700' },
  error: { color: colors.danger, textAlign: 'center', fontSize: 15 },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignSelf: 'center',
    marginTop: 10,
  },
  ghostText: { color: colors.text, fontWeight: '700', fontSize: 16 },
  menuBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  back: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backText: { color: colors.text, fontSize: 16, fontWeight: '800' },
  cartChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cartChipText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  menuShell: { flex: 1, flexDirection: 'row' },
  menuShellCol: { flexDirection: 'column' },
  catCol: { width: 220, borderRightWidth: 1, borderRightColor: colors.border },
  catColInner: { padding: 10, gap: 10 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  catTile: {
    minHeight: 72,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  catTileOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  catTileText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  catTileTextOn: { color: '#fff' },
  grid: { padding: 16, paddingBottom: 120 },
  gridRow: { gap: 12, marginBottom: 12 },
  tile: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pic: { height: 150, width: '100%', backgroundColor: colors.surface2 },
  picEmpty: { alignItems: 'center', justifyContent: 'center' },
  picHint: { fontSize: 36 },
  itemName: { color: colors.text, fontWeight: '800', fontSize: 18, paddingHorizontal: 12, paddingTop: 10, minHeight: 56 },
  price: { color: colors.accent2, fontWeight: '800', fontSize: 20, padding: 12 },
  lastBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  lastInfo: { flex: 1 },
  lastName: { color: colors.text, fontWeight: '800', fontSize: 18 },
  lastMeta: { color: colors.textMuted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  qtyBtnText: { color: colors.text, fontSize: 24, fontWeight: '800' },
  qtyVal: { color: colors.text, fontWeight: '800', fontSize: 20, minWidth: 24, textAlign: 'center' },
  fullOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    zIndex: 22,
  },
  overlayTitle: { color: colors.text, fontSize: 32, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  cartList: { flex: 1 },
  cartLine: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  cartTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cartName: { color: colors.text, fontWeight: '800', fontSize: 16, flexShrink: 1 },
  mods: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  submit: { minWidth: 0, width: '100%', minHeight: 72, marginTop: 10 },
  payTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' },
  payTile: {
    width: 280,
    minHeight: 180,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payEmoji: { fontSize: 42 },
  payTileTitle: { color: colors.text, fontSize: 26, fontWeight: '800' },
  payTileSub: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
  qr: { width: 280, height: 280, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 16 },
  qrHint: { color: colors.text, fontSize: 18, textAlign: 'center', marginVertical: 16, lineHeight: 26 },
  idleWrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 24,
  },
  idleCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
});
