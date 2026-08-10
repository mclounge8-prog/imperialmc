import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { ModifierGroup } from '../api/client';

function formatMoney(value: number): string {
  return `${value.toFixed(0)} ₽`;
}

const UNIT_LABELS: Record<string, string> = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

function formatUnit(unit: string): string {
  return UNIT_LABELS[unit] || unit;
}

function formatOptionMeta(opt: { price: number; qty: number; unit: string | null; isDefault: boolean }): string {
  const parts: string[] = [];
  if (opt.qty > 0 && opt.unit) {
    parts.push(`${opt.qty} ${formatUnit(opt.unit)}`);
  }
  if (opt.price > 0) {
    parts.push(`+${formatMoney(opt.price)}`);
  }
  if (parts.length > 0) return parts.join(' · ');
  return opt.isDefault ? 'входит' : 'бесплатно';
}

export type CompositionTarget = {
  name: string;
  modifierGroups: ModifierGroup[];
} | null;

type Props = {
  target: CompositionTarget;
  onClose: () => void;
};

export default function CompositionModal({ target, onClose }: Props) {
  const groups = target?.modifierGroups ?? [];

  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Состав: {target?.name}</Text>
          {groups.length === 0 ? (
            <Text style={styles.emptyText}>Состав не задан</Text>
          ) : (
            <ScrollView style={styles.compositionList}>
              {groups.map((group) => (
                <View key={group.id ?? 'ungrouped'} style={styles.groupBlock}>
                  <Text style={styles.groupTitle}>{group.name}</Text>
                  {group.options.map((opt) => (
                    <View key={opt.modifierId} style={styles.compositionRow}>
                      <Text style={styles.compositionName}>
                        {opt.isDefault ? '✓ ' : '+ '}
                        {opt.name}
                      </Text>
                      <Text style={styles.compositionPrice}>{formatOptionMeta(opt)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>Закрыть</Text>
          </Pressable>
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
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  emptyText: { color: colors.textMuted, fontSize: 13, marginTop: 12, marginBottom: 4 },
  compositionList: { maxHeight: 380, width: '100%', marginTop: 8 },
  groupBlock: { marginTop: 10 },
  groupTitle: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  compositionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  compositionName: { color: colors.text, fontSize: 14, flex: 1, marginRight: 12 },
  compositionPrice: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  modalCancel: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontSize: 14 },
});
