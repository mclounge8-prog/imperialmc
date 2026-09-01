import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { MenuItem, ModifierGroup, ModifierOption } from '../api/client';

function formatMoney(value: number): string {
  return `${value.toFixed(0)} ₽`;
}

const UNIT_LABELS: Record<string, string> = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

function formatOptionMeta(opt: {
  price: number;
  qty: number;
  unit: string | null;
  isDefault: boolean;
}): string {
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

type OptionRowProps = {
  opt: ModifierOption;
  isSelected: boolean;
  isRadio: boolean;
  onToggle: (modifierId: number) => void;
};

// Отдельный memo-ряд: при выборе одного модификатора не перерисовываем весь список —
// на планшете это давало микролаги и «проглатывание» следующего свайпа.
const OptionRow = React.memo(function OptionRow({
  opt,
  isSelected,
  isRadio,
  onToggle,
}: OptionRowProps) {
  return (
    <Pressable
      style={[styles.optionRow, isSelected && styles.optionRowSelected]}
      onPress={() => onToggle(opt.modifierId)}
      // Даём ScrollView шанс забрать вертикальный жест раньше, чем Pressable
      // решит, что это тап (типичный Android-глюк «свайп иногда не едет»).
      delayPressIn={50}
    >
      <View
        style={[
          styles.checkbox,
          isRadio && styles.checkboxRadio,
          isSelected && styles.checkboxChecked,
        ]}
      >
        {isSelected ? <View style={isRadio ? styles.radioDot : styles.checkboxTick} /> : null}
      </View>
      <Text style={styles.optionName}>{opt.name}</Text>
      <Text style={styles.optionPrice}>{formatOptionMeta(opt)}</Text>
    </Pressable>
  );
});

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

  const groups = useMemo(() => {
    const list = item?.modifierGroups ?? [];
    // Группы с дефолтными ингредиентами выше, допы — ниже.
    return [...list].sort((a, b) => {
      const aDef = a.options.some((o) => o.isDefault) ? 0 : 1;
      const bDef = b.options.some((o) => o.isDefault) ? 0 : 1;
      if (aDef !== bDef) return aDef - bDef;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [item]);

  const countInGroup = useCallback(
    (group: ModifierGroup, selectedSet: Set<number>): number =>
      group.options.filter((o) => selectedSet.has(o.modifierId)).length,
    []
  );

  const toggleInGroup = useCallback(
    (group: ModifierGroup, modifierId: number) => {
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
        if (group.maxSelect != null && countInGroup(group, next) >= group.maxSelect) {
          return prev;
        }
        next.add(modifierId);
        return next;
      });
    },
    [countInGroup]
  );

  const groupToggleHandlers = useMemo(() => {
    const map = new Map<number | string, (modifierId: number) => void>();
    for (const group of groups) {
      const key = group.id ?? 'ungrouped';
      map.set(key, (modifierId: number) => toggleInGroup(group, modifierId));
    }
    return map;
  }, [groups, toggleInGroup]);

  if (!item) return null;

  const selectedOptions = groups.flatMap((g) => g.options).filter((o) => selected.has(o.modifierId));
  const totalPrice = item.price + selectedOptions.reduce((sum, o) => sum + o.price, 0);

  const canConfirm = groups.every((g) => {
    if (!g.id) return true;
    const count = countInGroup(g, selected);
    const optionCount = g.options.length;
    const minSelect = Math.min(g.minSelect, optionCount);
    const maxSelect = g.maxSelect == null ? null : Math.min(g.maxSelect, optionCount);
    return count >= minSelect && (maxSelect == null || count <= maxSelect);
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop и карточка — siblings. Раньше ScrollView сидел внутри Pressable
          (stopPropagation), из‑за этого Android то отдавал жест скроллу, то
          родителю → «свайп иногда игнорируется». */}
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.modalBox}>
          <Text style={styles.title} numberOfLines={2}>
            {item.name}
          </Text>

          <ScrollView
            style={styles.groupsScroll}
            contentContainerStyle={styles.groupsScrollContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {groups.map((group) => {
              const key = group.id ?? 'ungrouped';
              const onToggle = groupToggleHandlers.get(key)!;
              const isRadio = group.maxSelect === 1;
              // Сначала то, что входит по умолчанию (галочки), ниже — допы.
              const orderedOptions = [...group.options].sort((a, b) => {
                if (a.isDefault === b.isDefault) return a.name.localeCompare(b.name, 'ru');
                return a.isDefault ? -1 : 1;
              });
              return (
                <View key={key} style={styles.groupBlock}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle}>{group.name}</Text>
                    {group.id != null && (
                      <Text style={styles.groupLimit}>
                        {(() => {
                          const optionCount = group.options.length;
                          const maxSelect =
                            group.maxSelect == null
                              ? null
                              : Math.min(group.maxSelect, optionCount);
                          const minSelect = Math.min(group.minSelect, optionCount);
                          if (maxSelect === 1) return 'выберите один';
                          if (maxSelect != null) {
                            return minSelect > 0 && minSelect === maxSelect
                              ? `ровно ${maxSelect}`
                              : `до ${maxSelect}`;
                          }
                          return 'любое количество';
                        })()}
                        {Math.min(group.minSelect, group.options.length) > 0 ? ' · обязательно' : ''}
                      </Text>
                    )}
                  </View>

                  {orderedOptions.map((opt) => (
                    <OptionRow
                      key={opt.modifierId}
                      opt={opt}
                      isSelected={selected.has(opt.modifierId)}
                      isRadio={isRadio}
                      onToggle={onToggle}
                    />
                  ))}
                </View>
              );
            })}
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
        </View>
      </View>
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
    // Выше absoluteFill-backdrop, чтобы тачи шли в карточку, а не «сквозь» неё.
    zIndex: 1,
    elevation: 4,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  groupsScroll: { flexGrow: 0, flexShrink: 1, marginBottom: 8 },
  groupsScrollContent: { paddingBottom: 4 },
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
