import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { MenuItem, ModifierGroup } from '../api/client';

function formatMoney(value: number): string {
  return `${value.toFixed(0)} ₽`;
}

const UNIT_LABELS: Record<string, string> = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

function formatOptionMeta(opt: { price: number; qty: number; unit: string | null; isDefault: boolean }): string {
  const parts: string[] = [];
  if (opt.qty > 0 && opt.unit) {
    parts.push(`${opt.qty} ${UNIT_LABELS[opt.unit] || opt.unit}`);
  }
  if (opt.price > 0) {
    parts.push(`+${formatMoney(opt.price)}`);
  }
  if (parts.length > 0) return parts.join(' · ');
  return opt.isDefault ? '' : 'беспл.';
}

type Props = {
  item: MenuItem | null;
  onClose: () => void;
  onConfirm: (modifierIds: number[]) => void;
};

// Экран настройки состава при добавлении позиции в заказ — открывается только
// если у позиции есть хоть один модификатор (обычный ингредиент или платная
// добавка). Дефолтные ингредиенты уже отмечены — их можно снять ("без
// огурцов"), остальное можно докупить ("+ картофель фри"), без создания
// отдельной позиции меню и без набора состава руками с нуля.
export default function ItemCustomizeModal({ item, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!item) return;
    const defaults = new Set<number>();
    for (const group of item.modifierGroups) {
      for (const opt of group.options) {
        if (opt.isDefault) defaults.add(opt.modifierId);
      }
    }
    setSelected(defaults);
  }, [item]);

  if (!item) return null;

  const countInGroup = (group: ModifierGroup): number =>
    group.options.filter((o) => selected.has(o.modifierId)).length;

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
      if (group.maxSelect != null && countInGroup(group) >= group.maxSelect) {
        return prev;
      }
      next.add(modifierId);
      return next;
    });
  };

  const selectedOptions = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => selected.has(o.modifierId));
  const totalPrice = item.price + selectedOptions.reduce((sum, o) => sum + o.price, 0);

  const canConfirm = item.modifierGroups.every((g) => {
    if (!g.id) return true;
    const count = countInGroup(g);
    return count >= g.minSelect && (g.maxSelect == null || count <= g.maxSelect);
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title} numberOfLines={2}>
            {item.name}
          </Text>

          <ScrollView style={styles.groupsScroll}>
            {item.modifierGroups.map((group) => (
              <View key={group.id ?? 'ungrouped'} style={styles.groupBlock}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.name}</Text>
                  {group.id != null && (
                    <Text style={styles.groupLimit}>
                      {group.maxSelect === 1
                        ? 'выберите один'
                        : group.maxSelect != null
                          ? `до ${group.maxSelect}`
                          : 'любое количество'}
                      {group.minSelect > 0 ? ' · обязательно' : ''}
                    </Text>
                  )}
                </View>

                {group.options.map((opt) => {
                  const isSelected = selected.has(opt.modifierId);
                  const isRadio = group.maxSelect === 1;
                  return (
                    <Pressable
                      key={opt.modifierId}
                      style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                      onPress={() => toggle(group, opt.modifierId)}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          isRadio && styles.checkboxRadio,
                          isSelected && styles.checkboxChecked,
                        ]}
                      >
                        {isSelected && (
                          <View style={isRadio ? styles.radioDot : styles.checkboxTick} />
                        )}
                      </View>
                      <Text style={styles.optionName}>{opt.name}</Text>
                      <Text style={styles.optionPrice}>{formatOptionMeta(opt)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.totalText}>Итого за шт.: {formatMoney(totalPrice)}</Text>
            <View style={styles.footerButtons}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
                disabled={!canConfirm}
                onPress={() => onConfirm([...selected])}
              >
                <Text style={styles.confirmButtonText}>Добавить</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  groupsScroll: { marginBottom: 8 },
  groupBlock: { marginBottom: 14 },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  groupTitle: { color: colors.accent2, fontSize: 13, fontWeight: '700' },
  groupLimit: { color: colors.textMuted, fontSize: 11 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
  },
  optionRowSelected: { backgroundColor: colors.surface2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxRadio: { borderRadius: 11 },
  checkboxChecked: { borderColor: colors.accent2 },
  checkboxTick: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.accent2 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent2 },
  optionName: { color: colors.text, fontSize: 14, flex: 1 },
  optionPrice: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    marginTop: 6,
  },
  totalText: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  footerButtons: { flexDirection: 'row', gap: 10 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  confirmButton: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.accent2,
  },
  confirmButtonDisabled: { opacity: 0.4 },
  confirmButtonText: { color: '#f1f1f3', fontSize: 15, fontWeight: '700' },
});
