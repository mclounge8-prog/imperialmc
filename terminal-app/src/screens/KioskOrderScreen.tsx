import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import KioskCheckoutPanel from '../components/KioskCheckoutPanel';
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

function catMark(name: string, icon: string | null): string {
  if (icon && icon.trim()) return icon.trim();
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '•';
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
  const { width, height } = useWindowDimensions();

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

  const openCheckout = useCallback(() => {
    if (!cart.length) return;
    bumpActivity();
    setCartOpen(false);
    setPayStep('type');
  }, [bumpActivity, cart.length]);

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
      setFlash(
        method === 'qr'
          ? `Заказ № ${data.ticket.number} · покажи скрин перевода сотруднику`
          : `Заказ № ${data.ticket.number} · оплата у сотрудника`
      );
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
  const landscape = width >= height;
  const catRail = landscape ? 168 : 148;
  const catTile = catRail - 20;
  const cols = width - catRail >= 1100 ? 4 : width - catRail >= 720 ? 3 : 2;
  const gridPad = 16;
  const gap = 14;
  const tileW = Math.max(150, Math.floor((width - catRail - gridPad * 2 - gap * (cols - 1)) / cols));
  const venueName = boot?.venue?.name || status?.venue?.name || 'Киоск';
  const visibleTickets = tickets.filter((t) => t.status !== 'cancelled');
  const discountPct = Number(boot?.venue?.cashlessDiscountPercent ?? 12);
  const qrUrl = boot?.venue?.qrImageUrl ? `${API_BASE_URL}${boot.venue.qrImageUrl}` : null;
  const currentCatName =
    categoryId === 'uncat' ? 'Ещё' : cats.find((c) => c.id === categoryId)?.name || 'Меню';

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
          <Text style={styles.homeLead}>Выбери блюда. Оплату подтвердит сотрудник на стойке.</Text>
          <Pressable
            style={styles.makeOrder}
            onPress={() => {
              bumpActivity();
              setOrdering(true);
            }}
          >
            <Text style={styles.makeOrderText}>Сделать заказ</Text>
          </Pressable>
          {flash ? <Text style={styles.flash}>{flash}</Text> : null}
          <Text style={styles.section}>Статусы заказов</Text>
          {!visibleTickets.length ? (
            <Text style={styles.empty}>Пока нет заказов с этого киоска</Text>
          ) : (
            visibleTickets.map((ticket) => (
              <View key={ticket.id} style={[styles.ticketRow, ticket.status === 'ready' && styles.ticketRowReady]}>
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

  const renderCatTile = (id: number | 'uncat', name: string, icon: string | null) => {
    const on = categoryId === id;
    return (
      <Pressable
        key={String(id)}
        style={[styles.catTile, { width: catTile, height: catTile }, on && styles.catTileOn]}
        onPress={() => {
          bumpActivity();
          setCategoryId(id);
        }}
      >
        <Text style={[styles.catMark, on && styles.catMarkOn]}>{catMark(name, icon)}</Text>
        <Text style={[styles.catName, on && styles.catNameOn]} numberOfLines={2}>
          {name}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root} onTouchStart={bumpActivity}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable style={styles.back} onPress={resetToHome}>
          <Text style={styles.backText}>← К статусам</Text>
        </Pressable>
        <VenueSecretTitle name={venueName} style={styles.venue} />
        <Text style={styles.topHint}>{currentCatName}</Text>
      </View>

      <View style={styles.menuShell}>
        <ScrollView
          style={[styles.catCol, { width: catRail }]}
          contentContainerStyle={styles.catColInner}
          showsVerticalScrollIndicator={false}
        >
          {cats.map((c) => renderCatTile(c.id, c.name, c.icon))}
          {menu?.uncategorized.length ? renderCatTile('uncat', 'Ещё', '🍽') : null}
        </ScrollView>

        <FlatList
          data={items}
          key={`${cols}-${tileW}`}
          numColumns={cols}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={cols > 1 ? [styles.gridRow, { gap }] : undefined}
          ListHeaderComponent={
            <Text style={styles.menuHeading} numberOfLines={1}>
              {currentCatName}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.empty}>В этой категории пока нет блюд</Text>}
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
                  <Text style={styles.picHint}>{catMark(item.name, '🍽')}</Text>
                </View>
              )}
              <View style={styles.tileCap}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.price}>{Math.round(item.price)} ₽</Text>
              </View>
            </Pressable>
          )}
        />
      </View>

      <View style={[styles.dock, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.dockLast}>
          {lastLine ? (
            <>
              <View style={styles.lastInfo}>
                <Text style={styles.lastName} numberOfLines={1}>
                  {lastLine.item.name}
                </Text>
                <Text style={styles.lastMeta} numberOfLines={1}>
                  {Math.round(lastLine.unitPrice * lastLine.qty)} ₽
                  {lineMods(lastLine.item, lastLine.modifierIds)
                    ? ` · ${lineMods(lastLine.item, lastLine.modifierIds)}`
                    : ''}
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
            </>
          ) : (
            <Text style={styles.dockHint}>Нажми плитку — блюдо попадёт в заказ</Text>
          )}
        </View>

        <Pressable
          style={styles.dockCart}
          onPress={() => {
            bumpActivity();
            setCartOpen(true);
          }}
        >
          <Text style={styles.dockCartIcon}>🛒</Text>
          <Text style={styles.dockCartLabel}>Корзина</Text>
          {cartCount ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          style={[styles.dockCheckout, !cart.length && styles.dockCheckoutOff]}
          disabled={!cart.length}
          onPress={openCheckout}
        >
          <Text style={styles.dockCheckoutText}>Оформить</Text>
          {cart.length ? <Text style={styles.dockCheckoutSum}>{Math.round(total)} ₽</Text> : null}
        </Pressable>
      </View>

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
            style={[styles.makeOrder, styles.submit, !cart.length && styles.dockCheckoutOff]}
            disabled={!cart.length}
            onPress={openCheckout}
          >
            <Text style={styles.makeOrderText}>Оформить · {Math.round(total)} ₽</Text>
          </Pressable>
          <Pressable
            style={styles.ghost}
            onPress={() => {
              bumpActivity();
              setCartOpen(false);
            }}
          >
            <Text style={styles.ghostText}>Назад к меню</Text>
          </Pressable>
        </View>
      ) : null}

      {payStep ? (
        <KioskCheckoutPanel
          cart={cart}
          total={total}
          discountPct={discountPct}
          qrUrl={qrUrl}
          step={payStep}
          busy={busy}
          error={error}
          onBack={() => {
            bumpActivity();
            setPayStep(payStep === 'type' ? null : payStep === 'qr' ? 'cashless' : 'type');
          }}
          onCash={() => void submit('cash')}
          onCashless={() => {
            bumpActivity();
            setPayStep('cashless');
          }}
          onCard={() => void submit('card')}
          onOpenQr={() => {
            bumpActivity();
            setPayStep('qr');
          }}
          onConfirmQr={() => void submit('qr')}
        />
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
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  venue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  topHint: { color: colors.textMuted, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
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
  empty: { color: colors.textMuted, fontSize: 16, textAlign: 'center', paddingVertical: 24 },
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
  back: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backText: { color: colors.text, fontSize: 16, fontWeight: '800' },
  menuShell: { flex: 1, flexDirection: 'row' },
  catCol: { borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.surface },
  catColInner: { padding: 10, gap: 10, alignItems: 'center', paddingBottom: 24 },
  catTile: {
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 8,
  },
  catTileOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  catMark: { color: colors.text, fontSize: 36, fontWeight: '800', lineHeight: 42 },
  catMarkOn: { color: '#fff' },
  catName: { color: colors.text, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  catNameOn: { color: '#fff' },
  menuHeading: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
    width: '100%',
  },
  grid: { padding: 16, paddingBottom: 24 },
  gridRow: { marginBottom: 14 },
  tile: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    overflow: 'hidden',
  },
  pic: { width: '100%', aspectRatio: 1, backgroundColor: colors.surface2 },
  picEmpty: { alignItems: 'center', justifyContent: 'center' },
  picHint: { fontSize: 48, color: colors.text },
  tileCap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, minHeight: 74, justifyContent: 'space-between' },
  itemName: { color: colors.text, fontWeight: '800', fontSize: 16, lineHeight: 20 },
  price: { color: colors.accent2, fontWeight: '800', fontSize: 20, marginTop: 6 },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  dockLast: {
    flex: 1,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dockHint: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  lastInfo: { flex: 1, minWidth: 0 },
  lastName: { color: colors.text, fontWeight: '800', fontSize: 17 },
  lastMeta: { color: colors.textMuted, marginTop: 2, fontSize: 13 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  qtyBtnText: { color: colors.text, fontSize: 24, fontWeight: '800' },
  qtyVal: { color: colors.text, fontWeight: '800', fontSize: 20, minWidth: 24, textAlign: 'center' },
  dockCart: {
    width: 88,
    height: 88,
    borderRadius: 20,
    backgroundColor: colors.surface2,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockCartIcon: { fontSize: 26 },
  dockCartLabel: { color: colors.text, fontWeight: '800', fontSize: 12, marginTop: 2 },
  badge: {
    position: 'absolute',
    top: 6,
    right: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  dockCheckout: {
    minWidth: 200,
    height: 88,
    borderRadius: 20,
    backgroundColor: colors.accent2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  dockCheckoutOff: { opacity: 0.35 },
  dockCheckoutText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  dockCheckoutSum: { color: '#dbe4ff', fontSize: 16, fontWeight: '800', marginTop: 2 },
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
