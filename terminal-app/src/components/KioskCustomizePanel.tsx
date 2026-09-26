import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { UNIT_LABELS } from '../kiosk/status';
import type { MenuItem, ModifierGroup } from '../api/client';

type Props = {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (modifierIds: number[]) => void;
};

function optionMeta(opt: { price: number; qty: number; unit: string | null }): string {
  const parts: string[] = [];
  if (opt.qty > 0 && opt.unit) parts.push(`${opt.qty} ${UNIT_LABELS[opt.unit] || opt.unit}`);
  if (opt.price > 0) parts.push(`+${Math.round(opt.price)} ₽`);
  return parts.join(' · ');
}

function mark(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '•';
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

  const selectedOptions = groups.flatMap((g) => g.options).filter((o) => selected.has(o.modifierId));
  const total = item.price + selectedOptions.reduce((sum, o) => sum + o.price, 0);

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
        <Text style={styles.lead}>Нажми квадрат, чтобы добавить или убрать</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {groups.map((group) => {
          const ordered = [...group.options].sort((a, b) => {
            if (a.isDefault === b.isDefault) return a.name.localeCompare(b.name, 'ru');
            return a.isDefault ? -1 : 1;
          });
          return (
            <View key={group.id ?? 'ungrouped'} style={styles.group}>
              <Text style={styles.groupTitle}>{group.name}</Text>
              <View style={styles.grid}>
                {ordered.map((opt) => {
                  const on = selected.has(opt.modifierId);
                  return (
                    <Pressable
                      key={opt.modifierId}
                      style={[
                        styles.tile,
                        { width: tileSize, height: tileSize },
                        on && styles.tileOn,
                        !on && opt.isDefault && styles.tileOff,
                      ]}
                      onPress={() => toggle(group, opt.modifierId)}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>
                        <Text style={styles.checkMark}>{on ? '✓' : ''}</Text>
                      </View>
                      <View style={[styles.glyph, on && styles.glyphOn]}>
                        <Text style={[styles.glyphText, on && styles.glyphTextOn]}>{mark(opt.name)}</Text>
                      </View>
                      <Text style={[styles.optName, !on && opt.isDefault && styles.optOff]} numberOfLines={2}>
                        {opt.name}
                      </Text>
                      {optionMeta(opt) ? <Text style={styles.optMeta}>{optionMeta(opt)}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.foot}>
        <Text style={styles.total}>{Math.round(total)} ₽</Text>
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
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, zIndex: 20 },
  head: { paddingHorizontal: 20, paddingBottom: 8 },
  back: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  backText: { color: colors.text, fontSize: 18, fontWeight: '800' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  lead: { color: colors.textMuted, fontSize: 16, marginTop: 4 },
  body: { padding: 20, paddingBottom: 24, gap: 22 },
  group: { gap: 12 },
  groupTitle: { color: colors.accent2, fontSize: 18, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: {
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileOn: { borderColor: colors.accent2, backgroundColor: '#1a2748' },
  tileOff: { opacity: 0.72 },
  check: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  checkOn: { backgroundColor: colors.accent2, borderColor: colors.accent2 },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 16 },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphOn: { backgroundColor: colors.accent },
  glyphText: { color: colors.text, fontSize: 34, fontWeight: '800' },
  glyphTextOn: { color: '#fff' },
  optName: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6 },
  optOff: { textDecorationLine: 'line-through', color: colors.textMuted },
  optMeta: { color: colors.accent2, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  total: { color: colors.text, fontSize: 32, fontWeight: '800', minWidth: 120 },
  add: {
    flex: 1,
    backgroundColor: colors.accent2,
    borderRadius: 18,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOff: { opacity: 0.4 },
  addText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});
