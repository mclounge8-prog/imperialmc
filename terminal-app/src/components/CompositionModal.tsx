import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { OrderItemRecipeEntry } from '../api/client';

const UNIT_LABELS: Record<string, string> = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

export function formatUnit(unit: string): string {
  return UNIT_LABELS[unit] || unit;
}

export type CompositionTarget = {
  name: string;
  recipe: OrderItemRecipeEntry[];
} | null;

type Props = {
  target: CompositionTarget;
  onClose: () => void;
};

export default function CompositionModal({ target, onClose }: Props) {
  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Состав: {target?.name}</Text>
          {target && target.recipe.length === 0 ? (
            <Text style={styles.emptyText}>Рецептура не задана</Text>
          ) : (
            <ScrollView style={styles.compositionList}>
              {target?.recipe.map((r, i) => (
                <View key={i} style={styles.compositionRow}>
                  <Text style={styles.compositionName}>{r.name}</Text>
                  <Text style={styles.compositionQty}>
                    {r.qty} {formatUnit(r.unit)}
                  </Text>
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
  compositionList: { maxHeight: 320, width: '100%', marginTop: 12 },
  compositionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  compositionName: { color: colors.text, fontSize: 14, flex: 1, marginRight: 12 },
  compositionQty: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  modalCancel: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontSize: 14 },
});