import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UNIT_LABELS } from '../kiosk/status';
import { kk } from '../kiosk/theme';
import type { MenuItem, ModifierGroup } from '../api/client';

type Props = {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (modifierIds: number[]) => void;
};

const CAT_COLORS = [
  { bg: '#1d3b66', text: '#bfdbfe', accent: '#3b82f6' },
  { bg: '#3d2a10', text: '#fcd34d', accent: '#f59e0b' },
  { bg: '#134032', text: '#86efac', accent: '#22c55e' },
  { bg: '#4a1630', text: '#f9a8d4', accent: '#ec4899' },
  { bg: '#2d2154', text: '#ddd6fe', accent: '#8b5cf6' },
  { bg: '#3f2610', text: '#fdba74', accent: '#f97316' },
  { bg: '#123044', text: '#67e8f9', accent: '#06b6d4' },
  { bg: '#4a1c14', text: '#fca5a5', accent: '#ef4444' },
];

function catColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i) * (i + 3)) % CAT_COLORS.length;
  return CAT_COLORS[hash];
}

function optionQty(opt: { qty: number; unit: string | null }): string {
  if (opt.qty > 0 && opt.unit) return `${opt.qty} ${UNIT_LABELS[opt.unit] || opt.unit}`;
  return '';
}

export default function KioskCustomizePanel({ item, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const cols = width >= 1100 ? 4 : width >= 720 ? 3 : 2;
  const gap = 14;
  const pad = 20;
  const tileSize = Math.floor((width - pad * 2 - gap * (cols - 1)) / cols);

  useEffect(() => {
    const next = new Set<number>();
    for (const group of item.modifierGroups) {
      for (const opt of group.options) {
        if (opt.isDefault) next.add(opt.modifierId);
      }
    }
    setSelected(next);
  }, [item]);

  const groups = useMemo(() => {
    return [...item.modifierGroups].sort((a, b) => {
      const aDef = a.options.some((o) => o.isDefault) ? 0 : 1;
      const bDef = b.options.some((o) => o.isDefault) ? 0 : 1;
      if (aDef !== bDef) return aDef - bDef;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [item]);

  const countInGroup = useCallback(
    (group: ModifierGroup, set: Set<number>) => group.options.filter((o) => set.has(o.modifierId)).length,
    []
  );

  const toggle = (group: ModifierGroup, modifierId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modifierId)) {
        next.delete(modifierId);
        return next;
      }
      if (group.maxSelect === 1) {
        for (const opt of group.options) next.delete(opt.modifierId);
        next.add(modifierId);
        return next;
      }
      if (group.maxSelect != null && countInGroup(group, next) >= group.maxSelect) return prev;
      next.add(modifierId);
      return next;
    });
  };

  const tiles = useMemo(
    () =>
      groups.flatMap((group) =>
        [...group.options]
          .sort((a, b) => {
            if (a.isDefault === b.isDefault) return a.name.localeCompare(b.name, 'ru');
            return a.isDefault ? -1 : 1;
          })
          .map((opt) => ({ group, opt }))
      ),
    [groups]
  );

  const selectedOptions = groups.flatMap((g) => g.options).filter((o) => selected.has(o.modifierId));
  const extras = selectedOptions.reduce((sum, o) => sum + o.price, 0);
  const total = item.price + extras;

  const canConfirm = groups.every((g) => {
    if (!g.id) return true;
    const count = countInGroup(g, selected);
    const optionCount = g.options.length;
    const minSelect = Math.min(g.minSelect, optionCount);
    const maxSelect = g.maxSelect == null ? null : Math.min(g.maxSelect, optionCount);
    return count >= minSelect && (maxSelect == null || count <= maxSelect);
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.head}>
        <Pressable style={styles.back} onPress={onClose}>
          <Text style={styles.backText}>← Меню</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.lead}>Категория сверху, доплата снизу. Нажми плитку, чтобы добавить или убрать</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {tiles.map(({ group, opt }) => {
            const on = selected.has(opt.modifierId);
            const tint = catColor(group.name);
            const extra = opt.price > 0;
            const qty = optionQty(opt);
            return (
              <Pressable
                key={opt.modifierId}
                style={[
                  styles.tile,
                  {
                    width: tileSize,
                    height: tileSize,
                    borderColor: on ? kk.gold : tint.accent,
                  },
                  on && styles.tileOn,
                  !on && opt.isDefault && styles.tileOff,
                ]}
                onPress={() => toggle(group, opt.modifierId)}
              >
                <View style={[styles.catBar, { backgroundColor: tint.bg }]}>
                  <View style={[styles.catDot, { backgroundColor: tint.accent }]} />
                  <Text style={[styles.catBarText, { color: tint.text }]} numberOfLines={2}>
                    {group.name}
                  </Text>
                  <View style={[styles.check, on && styles.checkOn]}>
                    <Text style={styles.checkMark}>{on ? '✓' : ''}</Text>
                  </View>
                </View>
                <View style={styles.tileMid}>
                  <Text style={[styles.optName, !on && opt.isDefault && styles.optOff]} numberOfLines={3}>
                    {opt.name}
                  </Text>
                  {qty ? <Text style={styles.qty}>{qty}</Text> : null}
                </View>
                <View style={[styles.priceBar, extra ? styles.priceBarOn : styles.priceBarOff]}>
                  <Text style={[styles.priceText, extra ? styles.priceTextOn : styles.priceTextOff]}>
                    {extra ? `+${Math.round(opt.price)} ₽` : 'без доплаты'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <View>
          <Text style={styles.total}>{Math.round(total)} ₽</Text>
          {extras > 0 ? <Text style={styles.extras}>доплаты +{Math.round(extras)} ₽</Text> : null}
        </View>
        <Pressable
          style={[styles.add, !canConfirm && styles.addOff]}
          disabled={!canConfirm}
          onPress={() => onConfirm([...selected])}
        >
          <Text style={styles.addText}>В заказ</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: kk.bg, zIndex: 20 },
  head: { paddingHorizontal: 20, paddingBottom: 8 },
  back: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: kk.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  backText: { color: kk.cream, fontSize: 18, fontWeight: '800' },
  title: { color: kk.gold, fontSize: 30, fontWeight: '800' },
  lead: { color: kk.muted, fontSize: 16, marginTop: 4 },
  body: { padding: 20, paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: {
    backgroundColor: kk.surface,
    borderWidth: 3,
    borderColor: kk.border,
    borderRadius: 24,
    overflow: 'hidden',
  },
  tileOn: { borderColor: kk.gold, backgroundColor: '#2a210c' },
  tileOff: { opacity: 0.72 },
  catDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  catBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 44,
  },
  catBarText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  checkOn: { backgroundColor: kk.gold, borderColor: kk.gold },
  checkMark: { color: kk.ink, fontWeight: '800', fontSize: 15 },
  tileMid: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, gap: 4 },
  optName: { color: kk.cream, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  optOff: { textDecorationLine: 'line-through', color: kk.muted },
  qty: { color: kk.muted, fontSize: 13, fontWeight: '700' },
  priceBar: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  priceBarOn: { backgroundColor: '#3f2d0a' },
  priceBarOff: { backgroundColor: kk.surface2 },
  priceText: { fontWeight: '800', fontSize: 18 },
  priceTextOn: { color: '#fbbf24' },
  priceTextOff: { color: kk.muted, fontSize: 14 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: kk.border,
  },
  total: { color: kk.cream, fontSize: 32, fontWeight: '800', minWidth: 120 },
  extras: { color: '#fbbf24', fontWeight: '800', marginTop: 2 },
  add: {
    flex: 1,
    backgroundColor: kk.gold,
    borderRadius: 18,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOff: { opacity: 0.4 },
  addText: { color: kk.ink, fontSize: 24, fontWeight: '800' },
});
