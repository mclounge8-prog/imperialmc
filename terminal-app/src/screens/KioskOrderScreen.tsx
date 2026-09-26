import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useDevice } from '../context/DeviceContext';
import ItemCustomizeModal from '../components/ItemCustomizeModal';
import {
  API_BASE_URL,
  createKioskTicket,
  fetchKioskBootstrap,
  fetchKioskMenu,
  fetchKioskTicket,
} from '../api/client';
import type {
  KioskBootstrap,
  KioskTicket,
  MenuCategory,
  MenuItem,
} from '../api/client';

const STATUS_LABEL: Record<string, string> = {
  new: 'Принято',
  cooking: 'Готовится',
  ready: 'Готово',
  issued: 'Выдано',
  cancelled: 'Отменено',
};

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
  const extra = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => set.has(o.modifierId))
    .reduce((sum, o) => sum + o.price, 0);
  return item.price + extra;
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
  return item.modifierGroups.some((g) => g.id != null || g.options.some((o) => !o.isDefault));
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
  const { deviceToken, status, refresh, clearRegistration } = useDevice();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 860;

  const [boot, setBoot] = useState<KioskBootstrap | null>(null);
  const [menu, setMenu] = useState<{ categories: MenuCategory[]; uncategorized: MenuItem[] } | null>(
    null
  );
  const [categoryId, setCategoryId] = useState<number | 'uncat' | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customize, setCustomize] = useState<MenuItem | null>(null);
  const [ticket, setTicket] = useState<KioskTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBoot = useCallback(async () => {
    if (!deviceToken) return;
    try {
      const next = await fetchKioskBootstrap(deviceToken);
      setBoot(next);
      setError(null);
      if (next.ready && !ticket) {
        const data = await fetchKioskMenu(deviceToken);
        setMenu(data);
        setCategoryId((prev) => {
          if (prev != null) return prev;
          return data.categories[0]?.id ?? (data.uncategorized.length ? 'uncat' : null);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось связаться с сервером');
    }
  }, [deviceToken, ticket]);

  useEffect(() => {
    loadBoot();
    const id = setInterval(loadBoot, ticket ? 8000 : 4000);
    return () => clearInterval(id);
  }, [loadBoot, ticket]);

  useEffect(() => {
    if (!ticket || !deviceToken) return;
    let stop = false;
    const tick = async () => {
      try {
        const data = await fetchKioskTicket(deviceToken, ticket.id);
        if (!stop) setTicket(data.ticket);
      } catch {
        /* keep last */
      }
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [ticket?.id, deviceToken]);

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
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0)
    );
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
      setTicket(data.ticket);
      setCart([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось оформить');
    } finally {
      setBusy(false);
    }
  };

  const total = cart.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);

  if (ticket) {
    const done = ticket.status === 'issued' || ticket.status === 'cancelled' || ticket.status === 'ready';
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.eyebrow}>Номер заказа</Text>
        <Text style={styles.ticketNum}>{ticket.number}</Text>
        <Text style={styles.ticketStatus}>{STATUS_LABEL[ticket.status] || ticket.status}</Text>
        <Text style={styles.hint}>Покажи номер на выдаче. Оплата — у кассира.</Text>
        <ScrollView style={styles.ticketItems}>
          {ticket.items.map((item) => (
            <View key={item.id} style={styles.ticketLine}>
              <Text style={styles.cartName}>
                {item.qty}× {item.name} · {Math.round(item.price * item.qty)} ₽
              </Text>
              {item.modifiers.length ? (
                <Text style={styles.mods}>
                  {item.modifiers
                    .map((m) => `${m.name}${m.qty && m.unitLabel ? ` ${m.qty} ${m.unitLabel}` : ''}`)
                    .join(', ')}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
        {done ? (
          <Pressable
            style={styles.primary}
            onPress={() => {
              setTicket(null);
              loadBoot();
            }}
          >
            <Text style={styles.primaryText}>Новый заказ</Text>
          </Pressable>
        ) : (
          <Text style={styles.hint}>Ждём кухню…</Text>
        )}
      </View>
    );
  }

  if (!boot?.ready) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.eyebrow}>Киоск</Text>
        <Text style={styles.title}>Ожидание</Text>
        <Text style={styles.wait}>{waitReason(boot)}</Text>
        <Text style={styles.hint}>
          Терминал официанта на этом планшете не трогаем — киоск регистрируется отдельным устройством.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.ghost} onPress={() => refresh()}>
          <Text style={styles.ghostText}>Обновить</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={() => clearRegistration()}>
          <Text style={styles.ghostText}>Сбросить устройство</Text>
        </Pressable>
      </View>
    );
  }

  const cartBlock = (
    <View style={[styles.cart, wide ? styles.cartWide : styles.cartNarrow]}>
      <Text style={styles.cartTitle}>Заказ</Text>
      <ScrollView style={styles.cartList}>
        {!cart.length ? <Text style={styles.hint}>Выбери блюда</Text> : null}
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
      <View style={styles.cartFoot}>
        <View style={styles.cartTop}>
          <Text style={styles.total}>Итого</Text>
          <Text style={styles.total}>{Math.round(total)} ₽</Text>
        </View>
        <Pressable style={styles.primary} disabled={!cart.length || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Оформить</Text>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.shell, !wide && styles.shellCol, { paddingTop: insets.top }]}>
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={styles.venue}>{status?.venue?.name || 'Киоск'}</Text>
          <Text style={styles.hint}>Самообслуживание</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
          {cats.map((c) => (
            <Pressable
              key={c.id}
              style={[styles.chip, categoryId === c.id && styles.chipOn]}
              onPress={() => setCategoryId(c.id)}
            >
              <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>{c.name}</Text>
            </Pressable>
          ))}
          {menu?.uncategorized.length ? (
            <Pressable
              style={[styles.chip, categoryId === 'uncat' && styles.chipOn]}
              onPress={() => setCategoryId('uncat')}
            >
              <Text style={[styles.chipText, categoryId === 'uncat' && styles.chipTextOn]}>Ещё</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <ScrollView contentContainerStyle={styles.grid}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              style={styles.item}
              onPress={() => (needsCustomize(item) ? setCustomize(item) : addLine(item, defaultIds(item)))}
            >
              {item.imageUrl ? (
                <FastImage
                  source={{
                    uri: `${API_BASE_URL}${item.imageUrl}`,
                    cache: FastImage.cacheControl.immutable,
                  }}
                  style={styles.pic}
                />
              ) : (
                <View style={[styles.pic, styles.picEmpty]}>
                  <Text style={styles.hint}>🍽</Text>
                </View>
              )}
              <Text style={styles.itemName} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.price}>{Math.round(item.price)} ₽</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {cartBlock}
      <ItemCustomizeModal
        item={customize}
        onClose={() => setCustomize(null)}
        onConfirm={(ids) => customize && addLine(customize, ids)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  shell: { flex: 1, backgroundColor: colors.bg, flexDirection: 'row' },
  shellCol: { flexDirection: 'column' },
  main: { flex: 1, minWidth: 0 },
  top: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  venue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  eyebrow: { color: colors.accent2, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  wait: {
    color: colors.text,
    backgroundColor: colors.surface2,
    padding: 12,
    borderRadius: 10,
    textAlign: 'center',
    maxWidth: 420,
  },
  hint: { color: colors.textMuted, textAlign: 'center', maxWidth: 400, lineHeight: 20 },
  error: { color: colors.danger, textAlign: 'center' },
  cats: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  chipText: { color: colors.text, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  item: {
    width: 170,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  pic: { height: 110, width: '100%', backgroundColor: colors.surface2 },
  picEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemName: { color: colors.text, fontWeight: '700', paddingHorizontal: 10, paddingTop: 8 },
  price: { color: colors.accent2, fontWeight: '800', padding: 10 },
  cart: { backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border },
  cartWide: { width: 360 },
  cartNarrow: { width: '100%', maxHeight: '42%', borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: colors.border },
  cartTitle: { color: colors.text, fontSize: 22, fontWeight: '800', padding: 16 },
  cartList: { flex: 1, paddingHorizontal: 16 },
  cartLine: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  cartTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cartName: { color: colors.text, fontWeight: '700', flexShrink: 1 },
  mods: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  qtyBtnText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  qtyVal: { color: colors.text, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  cartFoot: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  total: { color: colors.text, fontSize: 18, fontWeight: '800' },
  primary: {
    backgroundColor: colors.accent2,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  ghostText: { color: colors.text, fontWeight: '700' },
  ticketNum: { color: colors.text, fontSize: 84, fontWeight: '800', textAlign: 'center' },
  ticketStatus: {
    alignSelf: 'center',
    color: colors.accent2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontWeight: '800',
    overflow: 'hidden',
  },
  ticketItems: { marginTop: 16, maxHeight: 240 },
  ticketLine: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
});
