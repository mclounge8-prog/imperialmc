import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function KioskCustomizePanel({ item, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
    (group: ModifierGroup, set: Set<number>) =>
      group.options.filter((o) => set.has(o.modifierId)).length,
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
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <View style={styles.headText}>
          <Text style={styles.title}>{item.name}</Text>
          <Text style={styles.lead}>Нажми, чтобы добавить или убрать. Всё крупно — как на витрине.</Text>
        </View>
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
              <View style={styles.tiles}>
                {ordered.map((opt) => {
                  const on = selected.has(opt.modifierId);
                  const action = on
                    ? opt.isDefault
                      ? 'В составе · нажми, чтобы убрать'
                      : 'Добавлено · нажми, чтобы убрать'
                    : opt.isDefault
                      ? 'Убрано · нажми, чтобы вернуть'
                      : 'Нажми, чтобы добавить';
                  return (
                    <Pressable
                      key={opt.modifierId}
                      style={[styles.tile, on && styles.tileOn, !on && opt.isDefault && styles.tileOff]}
                      onPress={() => toggle(group, opt.modifierId)}
                    >
                      <Text style={[styles.optName, !on && opt.isDefault && styles.optOff]}>{opt.name}</Text>
                      {optionMeta(opt) ? <Text style={styles.optMeta}>{optionMeta(opt)}</Text> : null}
                      <Text style={[styles.optAction, on && styles.optActionOn]}>{action}</Text>
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
        <Pressable style={[styles.add, !canConfirm && styles.addOff]} disabled={!canConfirm} onPress={() => onConfirm([...selected])}>
          <Text style={styles.addText}>В заказ</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, zIndex: 20 },
  head: { paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  back: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backText: { color: colors.text, fontSize: 18, fontWeight: '800' },
  headText: { gap: 4 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800' },
  lead: { color: colors.textMuted, fontSize: 16 },
  body: { padding: 20, paddingBottom: 24, gap: 20 },
  group: { gap: 10 },
  groupTitle: { color: colors.accent2, fontSize: 20, fontWeight: '800' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    minWidth: 220,
    flexGrow: 1,
    flexBasis: '40%',
    minHeight: 110,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    justifyContent: 'center',
    gap: 4,
  },
  tileOn: { borderColor: colors.accent2, backgroundColor: '#1a2748' },
  tileOff: { opacity: 0.72 },
  optName: { color: colors.text, fontSize: 22, fontWeight: '800' },
  optOff: { textDecorationLine: 'line-through', color: colors.textMuted },
  optMeta: { color: colors.accent2, fontSize: 16, fontWeight: '700' },
  optAction: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginTop: 4 },
  optActionOn: { color: '#9db4ff' },
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
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOff: { opacity: 0.4 },
  addText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});
