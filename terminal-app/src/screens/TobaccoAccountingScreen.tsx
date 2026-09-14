import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import ScreenSwipeHost from '../components/ScreenSwipeHost';
import { useDevice } from '../context/DeviceContext';
import { useSession } from '../context/SessionContext';
import {
  fetchTobaccoState,
  saveTobaccoCount,
  updateTobaccoTareQty,
} from '../api/client';

function formatG(value: number): string {
  const n = Number(value) || 0;
  return `${Math.round(n).toLocaleString('ru-RU')} г`;
}

type TareRow = {
  id: number;
  brand: string;
  label: string;
  tareWeightG: number;
  qty: number;
  netContentG?: number | null;
};

type CountDraft = {
  tobaccoTareId: number;
  label: string;
  tareWeightG: number;
  canQty: number;
  parts: string[];
};

function netOf(draft: CountDraft): number {
  const gross = draft.parts.reduce((sum, p) => sum + (Number(p.replace(',', '.')) || 0), 0);
  return gross - draft.tareWeightG * draft.canQty;
}

export default function TobaccoAccountingScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venueId = status?.venue?.id ?? null;
  const token = session?.token ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tares, setTares] = useState<TareRow[]>([]);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [lastCountNet, setLastCountNet] = useState<number | null>(null);
  const [lastWithin, setLastWithin] = useState<boolean | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [drafts, setDrafts] = useState<CountDraft[]>([]);

  const load = useCallback(async () => {
    if (!venueId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTobaccoState(venueId, token);
      setTares(data.tares || []);
      setShiftId(data.shiftId);
      if (data.count && !data.count.skipped) {
        setLastCountNet(data.count.totalNetG);
        setLastWithin(data.count.withinTolerance);
      } else {
        setLastCountNet(null);
        setLastWithin(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить учёт');
    } finally {
      setLoading(false);
    }
  }, [venueId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const changeQty = async (tareId: number, delta: number) => {
    if (!venueId || !token) return;
    try {
      const data = await updateTobaccoTareQty(venueId, token, tareId, { delta });
      setTares(data.tares || []);
    } catch (e) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось изменить кол-во');
    }
  };

  const openCount = () => {
    if (!shiftId) {
      Alert.alert('Нет открытой смены', 'Откройте смену, чтобы сохранить подсчёт табака.');
      return;
    }
    const withQty = tares.filter((t) => t.qty > 0);
    if (!withQty.length) {
      Alert.alert('Нет тары', 'Сначала укажите количество банок по брендам.');
      return;
    }
    setDrafts(
      withQty.map((t) => ({
        tobaccoTareId: t.id,
        label: t.label,
        tareWeightG: t.tareWeightG,
        canQty: t.qty,
        parts: [''],
      }))
    );
    setCountOpen(true);
  };

  const totalNet = useMemo(() => drafts.reduce((sum, d) => sum + netOf(d), 0), [drafts]);

  const submitCount = async () => {
    if (!venueId || !token) return;
    for (const d of drafts) {
      const hasWeight = d.parts.some((p) => (Number(p.replace(',', '.')) || 0) > 0);
      if (!hasWeight) {
        Alert.alert('Не хватает данных', `Укажите вес для «${d.label}»`);
        return;
      }
    }
    setSaving(true);
    try {
      const result = await saveTobaccoCount(venueId, token, {
        lines: drafts.map((d) => ({
          tobaccoTareId: d.tobaccoTareId,
          canQty: d.canQty,
          grossWeightParts: d.parts
            .map((p) => Number(p.replace(',', '.')))
            .filter((v) => Number.isFinite(v) && v >= 0),
        })),
      });
      setLastCountNet(result.summary.totalNetG);
      setLastWithin(result.summary.withinTolerance);
      setCountOpen(false);
      Alert.alert(
        'Учёт сохранён',
        `Чистый табак: ${formatG(result.summary.totalNetG)}\n` +
          (result.summary.withinTolerance
            ? 'В пределах допустимой погрешности.'
            : 'Вне допустимой погрешности — проверьте взвешивание.')
      );
      await load();
    } catch (e) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  return (
    <ScreenSwipeHost screen="TobaccoAccounting">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Укажите количество банок по тарам, затем нажмите «Подсчёт». Вес можно вводить частями через «+» —
          программа вычтет вес тары × кол-во банок.
        </Text>

        {lastCountNet != null ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Последний подсчёт в смене</Text>
            <Text style={styles.summaryValue}>{formatG(lastCountNet)}</Text>
            <Text style={styles.summaryMeta}>
              {lastWithin ? 'В допуске' : 'Вне допуска'} · остатки склада не показываются
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionLabel}>Тара на точке</Text>
        <View style={styles.card}>
          {tares.length === 0 ? (
            <Text style={styles.empty}>Нет привязанных тар. Настройте учёт в бэкофисе.</Text>
          ) : (
            tares.map((tare, idx) => (
              <View key={tare.id} style={[styles.row, idx < tares.length - 1 && styles.rowBorder]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{tare.label}</Text>
                  <Text style={styles.rowSub}>тара {formatG(tare.tareWeightG)}</Text>
                </View>
                <View style={styles.qtyBlock}>
                  <Pressable style={styles.qtyBtn} onPress={() => changeQty(tare.id, -1)}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyValue}>{tare.qty}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => changeQty(tare.id, 1)}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.primaryBtn} onPress={openCount}>
          <Text style={styles.primaryBtnText}>Подсчёт</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={countOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <Text style={styles.modalTitle}>Подсчёт табака</Text>
            <Text style={styles.modalHint}>Чистый вес сейчас: {formatG(totalNet)}</Text>
            <ScrollView style={styles.modalScroll} contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
              {drafts.map((draft, draftIdx) => (
                <View key={draft.tobaccoTareId} style={styles.draftCard}>
                  <Text style={styles.draftTitle}>
                    {draft.label} · {draft.canQty} шт
                  </Text>
                  <Text style={styles.draftSub}>
                    − тара {formatG(draft.tareWeightG)} × {draft.canQty} ={' '}
                    {formatG(draft.tareWeightG * draft.canQty)}
                  </Text>
                  {draft.parts.map((part, partIdx) => (
                    <View key={partIdx} style={styles.partRow}>
                      <TextInput
                        style={styles.partInput}
                        keyboardType="decimal-pad"
                        value={part}
                        placeholder="Вес, г"
                        placeholderTextColor={colors.textMuted}
                        onChangeText={(text) => {
                          setDrafts((prev) =>
                            prev.map((d, i) => {
                              if (i !== draftIdx) return d;
                              const parts = d.parts.slice();
                              parts[partIdx] = text;
                              return { ...d, parts };
                            })
                          );
                        }}
                      />
                      {partIdx === draft.parts.length - 1 ? (
                        <Pressable
                          style={styles.addPartBtn}
                          onPress={() => {
                            setDrafts((prev) =>
                              prev.map((d, i) =>
                                i === draftIdx ? { ...d, parts: [...d.parts, ''] } : d
                              )
                            );
                          }}
                        >
                          <Text style={styles.addPartText}>+</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.addPartSpacer} />
                      )}
                    </View>
                  ))}
                  <Text style={styles.draftNet}>чистое: {formatG(netOf(draft))}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => setCountOpen(false)} disabled={saving}>
                <Text style={styles.secondaryBtnText}>Отмена</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={submitCount} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? '…' : 'Сохранить'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenSwipeHost>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  qtyBlock: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surface2 || '#24242a',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { color: colors.text, fontSize: 20, fontWeight: '600' },
  qtyValue: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  empty: { color: colors.textMuted, padding: 16, fontSize: 13 },
  summaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 12 },
  summaryValue: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  summaryMeta: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalPanel: {
    maxHeight: '90%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 10,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalHint: { color: colors.textMuted, fontSize: 13 },
  modalScroll: { maxHeight: 420 },
  draftCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  draftTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  draftSub: { color: colors.textMuted, fontSize: 12 },
  draftNet: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 4 },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.bg,
    fontSize: 16,
  },
  addPartBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  addPartText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  addPartSpacer: { width: 40 },
  modalActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
