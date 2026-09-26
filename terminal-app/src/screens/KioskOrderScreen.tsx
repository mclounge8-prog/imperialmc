import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { KioskBootstrap, KioskTicket, MenuCategory, MenuItem } from '../api/client';

type CartLine = {
  key: string;
  item: MenuItem;
  modifierIds: number[];
  unitPrice: number;
  qty: number;
};

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
  const [customize, setCustomize] = useState<MenuItem | null>(null);
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [ordering, setOrdering] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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
      } else if (deviceToken) {
        try {
          const mine = await fetchMyKioskTickets(deviceToken);
          setTickets(mine.tickets);
        } catch {
          /* ignore */
        }
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

  const cats = useMemo(() => flattenCats(menu?.categories || []), [menu]);
  const items = useMemo(() => {
    if (!menu || categoryId == null) return [];
    if (categoryId === 'uncat') return menu.uncategorized;
    const found = cats.find((c) => c.id === categoryId);
    if (!found) return [];
    return [...found.items, ...(found.children || []).flatMap((c) => c.items)];
  }, [menu, categoryId, cats]);

  const addLine = (item: MenuItem, modifierIds: number[]) => {
    const key = `${item.id}:${[...modifierIds].sort().join(',')}`;
    const unit = linePrice(item, modifierIds);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key, item, modifierIds, unitPrice: unit, qty: 1 }];
    });
    setCustomize(null);
    setCartOpen(true);
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  };

  const submit = async () => {
    if (!deviceToken || !cart.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await createKioskTicket(
        deviceToken,
        cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, modifierIds: l.modifierIds }))
      );
      setCart([]);
      setCartOpen(false);
      setOrdering(false);
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

  const onItemPress = (item: MenuItem) => {
    if (needsCustomize(item)) setCustomize(item);
    else addLine(item, defaultIds(item));
  };

  const header = (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
      <VenueSecretTitle name={venueName} style={styles.venue} />
      <Text style={styles.topHint}>Самообслуживание</Text>
    </View>
  );

  if (!boot?.ready) {
    return (
      <View style={[styles.root, styles.center]}>
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
          <Text style={styles.homeLead}>Выбери блюда на экране. Оплата — у кассира после оформления.</Text>
          <Pressable style={styles.makeOrder} onPress={() => setOrdering(true)}>
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
                style={[
                  styles.ticketRow,
                  ticket.status === 'ready' && styles.ticketRowReady,
                ]}
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

  const catButtons = (
    <>
      {cats.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.catBtn, categoryId === c.id && styles.catBtnOn]}
          onPress={() => setCategoryId(c.id)}
        >
          <Text style={[styles.catBtnText, categoryId === c.id && styles.catBtnTextOn]}>{c.name}</Text>
        </Pressable>
      ))}
      {menu?.uncategorized.length ? (
        <Pressable
          style={[styles.catBtn, categoryId === 'uncat' && styles.catBtnOn]}
          onPress={() => setCategoryId('uncat')}
        >
          <Text style={[styles.catBtnText, categoryId === 'uncat' && styles.catBtnTextOn]}>Ещё</Text>
        </Pressable>
      ) : null}
    </>
  );

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.menuBar}>
        <Pressable style={styles.back} onPress={() => setOrdering(false)}>
          <Text style={styles.backText}>← К статусам</Text>
        </Pressable>
        <Pressable style={styles.cartChip} onPress={() => setCartOpen((v) => !v)}>
          <Text style={styles.cartChipText}>
            Корзина {cartCount ? `· ${cartCount}` : ''} {total ? `· ${Math.round(total)} ₽` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.menuShell, !wide && styles.menuShellCol]}>
        {wide ? <ScrollView style={styles.catCol}>{catButtons}</ScrollView> : <View style={styles.catWrap}>{catButtons}</View>}
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
          renderItem={({ item }) => (
            <Pressable style={[styles.tile, { width: tileW }]} onPress={() => onItemPress(item)}>
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

      {cartOpen ? (
        <View style={[styles.cartSheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.cartHead}>
            <Text style={styles.cartTitle}>Твой заказ</Text>
            <Pressable onPress={() => setCartOpen(false)}>
              <Text style={styles.cartHide}>Скрыть</Text>
            </Pressable>
          </View>
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
          <Pressable style={[styles.makeOrder, styles.submit]} disabled={!cart.length || busy} onPress={submit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.makeOrderText}>Оформить · {Math.round(total)} ₽</Text>}
          </Pressable>
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
  center: {},
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
    minWidth: 320,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  makeOrderText: { color: '#fff', fontSize: 28, fontWeight: '800' },
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
  catCol: {
    width: 220,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    padding: 10,
  },
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  catBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  catBtnOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  catBtnText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  catBtnTextOn: { color: '#fff' },
  grid: { padding: 16, paddingBottom: 40 },
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
  cartSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '58%',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    zIndex: 15,
  },
  cartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cartTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  cartHide: { color: colors.accent2, fontWeight: '800', fontSize: 16 },
  cartList: { flexGrow: 0 },
  cartLine: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  cartTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cartName: { color: colors.text, fontWeight: '800', fontSize: 16, flexShrink: 1 },
  mods: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
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
  submit: { minWidth: 0, width: '100%', minHeight: 68, marginTop: 10 },
});
