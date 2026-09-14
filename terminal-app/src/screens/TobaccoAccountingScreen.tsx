import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  createTobaccoStockWriteoff,
  createTobaccoTareMovement,
  fetchTobaccoState,
  saveTobaccoCount,
  type TobaccoTareMovementType,
} from '../api/client';

function formatG(value: number): string {
  const n = Number(value) || 0;
  return `${Math.round(n).toLocaleString('ru-RU')} г`;
}

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

function applyKeypadDigit(prev: string, key: string, { decimals = 1 }: { decimals?: number } = {}): string {
  if (key === '⌫') {
    const next = prev.slice(0, -1);
    return next === '' ? '0' : next;
  }
  if (key === '.') {
    return prev.includes('.') ? prev : prev === '' ? '0.' : `${prev}.`;
  }
  const dotIndex = prev.indexOf('.');
  if (dotIndex !== -1 && prev.length - dotIndex > decimals) return prev;
  if (prev === '0') return key;
  return prev + key;
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

type MovementLineDraft = {
  key: string;
  tobaccoTareId: number | null;
  qty: string;
};

function netOf(draft: CountDraft): number {
  const gross = draft.parts.reduce((sum, p) => sum + (Number(p.replace(',', '.')) || 0), 0);
  return gross - draft.tareWeightG * draft.canQty;
}

function newMovementLine(): MovementLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tobaccoTareId: null,
    qty: '',
  };
}

function ModalShell({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <Pressable style={styles.modalBackdropPress} onPress={onRequestClose} />
        <View style={styles.modalCard}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Keypad({
  onKey,
}: {
  onKey: (key: string) => void;
}) {
  return (
    <View style={styles.keypad}>
      {KEY_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.keypadRow}>
          {row.map((key) => (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              onPress={() => onKey(key)}
            >
              <Text style={styles.keyText}>{key}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
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

  const [movementType, setMovementType] = useState<TobaccoTareMovementType | null>(null);
  const [movementLines, setMovementLines] = useState<MovementLineDraft[]>([newMovementLine()]);
  const [movementComment, setMovementComment] = useState('');

  const [stockWriteoffOpen, setStockWriteoffOpen] = useState(false);
  const [stockWriteoffAmount, setStockWriteoffAmount] = useState('');
  const [stockWriteoffComment, setStockWriteoffComment] = useState('');

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

  const openMovement = (type: TobaccoTareMovementType) => {
    if (!tares.length) {
      Alert.alert('Нет тары', 'Сначала привяжите тары к заведению в бэкофисе.');
      return;
    }
    setMovementType(type);
    setMovementLines([
      {
        ...newMovementLine(),
        tobaccoTareId: tares[0]?.id ?? null,
      },
    ]);
    setMovementComment('');
  };

  const closeMovement = () => {
    setMovementType(null);
    setMovementLines([newMovementLine()]);
    setMovementComment('');
  };

  const openStockWriteoff = () => {
    setStockWriteoffAmount('0');
    setStockWriteoffComment('');
    setStockWriteoffOpen(true);
  };

  const submitStockWriteoff = async () => {
    if (!venueId || !token) return;
    const amountG = Number(String(stockWriteoffAmount).replace(',', '.'));
    if (!Number.isFinite(amountG) || !(amountG > 0)) {
      Alert.alert('Не хватает данных', 'Укажите количество списания в граммах.');
      return;
    }
    setSaving(true);
    try {
      const result = await createTobaccoStockWriteoff(venueId, token, {
        amountG,
        comment: stockWriteoffComment.trim() || undefined,
      });
      setStockWriteoffOpen(false);
      Alert.alert('Списание сохранено', `Списано ${formatG(result.writeoff.amountG)} с остатка точки.`);
    } catch (e) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось списать остаток');
    } finally {
      setSaving(false);
    }
  };

  const submitMovement = async () => {
    if (!venueId || !token || !movementType) return;

    const parsed: Array<{ tobaccoTareId: number; qty: number }> = [];
    for (const line of movementLines) {
      if (line.tobaccoTareId == null) {
        Alert.alert('Не хватает данных', 'Выберите тару в каждой строке.');
        return;
      }
      const qty = Math.round(Number(String(line.qty).replace(',', '.')) || 0);
      if (!(qty > 0)) {
        Alert.alert('Не хватает данных', 'Укажите количество больше 0 в каждой строке.');
        return;
      }
      parsed.push({ tobaccoTareId: line.tobaccoTareId, qty });
    }

    if (!parsed.length) {
      Alert.alert('Пусто', 'Добавьте хотя бы одну позицию поставки.');
      return;
    }

    setSaving(true);
    try {
      const result = await createTobaccoTareMovement(venueId, token, {
        type: movementType,
        lines: parsed,
        comment: movementComment.trim() || undefined,
      });
      setTares(result.tares || []);
      closeMovement();
      const title = movementType === 'receipt' ? 'Приход сохранён' : 'Списание сохранено';
      const summary = (result.movement.lines || [])
        .map((l) => `• ${l.tareLabel}: ${l.qty} шт`)
        .join('\n');
      Alert.alert(title, summary || 'Готово');
    } catch (e) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const openCount = () => {
    if (!shiftId) {
      Alert.alert('Нет открытой смены', 'Откройте смену, чтобы сохранить подсчёт табака.');
      return;
    }
    const withQty = tares.filter((t) => t.qty > 0);
    if (!withQty.length) {
      Alert.alert('Нет тары', 'Сначала оформите приход тары на точку.');
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

  const movementTitle = movementType === 'receipt' ? 'Приход тары' : 'Списание тары';
  const movementHint =
    movementType === 'receipt'
      ? 'Добавьте позиции поставки: тара и количество. Можно несколько строк.'
      : 'Укажите, какую тару и сколько банок списать с точки.';

  return (
    <ScreenSwipeHost screen="TobaccoAccounting">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Тара — через «Приход» и «Списание». «Списание остатка» убирает граммы табака (меласса) со
          склада точки. Подсчёт — отдельно: вес частями через «+», минус тара × банки.
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
                <Text style={styles.qtyValue}>{tare.qty} шт</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionBtn, styles.actionReceipt]} onPress={() => openMovement('receipt')}>
            <Text style={styles.actionBtnText}>Приход</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionWriteoff]}
            onPress={() => openMovement('writeoff')}
          >
            <Text style={styles.actionBtnText}>Списание тары</Text>
          </Pressable>
        </View>

        <Pressable style={styles.stockWriteoffBtn} onPress={openStockWriteoff}>
          <Text style={styles.actionBtnText}>Списание остатка</Text>
          <Text style={styles.actionBtnSub}>меласса, граммы</Text>
        </Pressable>

        <Pressable style={styles.screenPrimaryBtn} onPress={openCount}>
          <Text style={styles.primaryBtnText}>Подсчёт</Text>
        </Pressable>
      </ScrollView>

      <ModalShell visible={movementType != null} onRequestClose={closeMovement}>
        <Text style={styles.modalTitle}>{movementTitle}</Text>
        <Text style={styles.modalHint}>{movementHint}</Text>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {movementLines.map((line, lineIdx) => (
            <View key={line.key} style={styles.draftCard}>
              <View style={styles.lineHeader}>
                <Text style={styles.draftTitle}>Позиция {lineIdx + 1}</Text>
                {movementLines.length > 1 ? (
                  <Pressable
                    onPress={() =>
                      setMovementLines((prev) => prev.filter((l) => l.key !== line.key))
                    }
                  >
                    <Text style={styles.removeLine}>Удалить</Text>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.fieldLabel}>Тара</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tareChips}>
                {tares.map((tare) => {
                  const selected = line.tobaccoTareId === tare.id;
                  return (
                    <Pressable
                      key={tare.id}
                      style={[styles.tareChip, selected && styles.tareChipActive]}
                      onPress={() =>
                        setMovementLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key ? { ...l, tobaccoTareId: tare.id } : l
                          )
                        )
                      }
                    >
                      <Text style={[styles.tareChipText, selected && styles.tareChipTextActive]}>
                        {tare.label}
                      </Text>
                      {movementType === 'writeoff' ? (
                        <Text style={[styles.tareChipMeta, selected && styles.tareChipTextActive]}>
                          {tare.qty} шт
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.fieldLabel}>Количество, шт</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputFull]}
                keyboardType="number-pad"
                value={line.qty}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                onChangeText={(text) =>
                  setMovementLines((prev) =>
                    prev.map((l) =>
                      l.key === line.key ? { ...l, qty: text.replace(/[^\d]/g, '') } : l
                    )
                  )
                }
              />
            </View>
          ))}

          <Pressable
            style={styles.addLineBtn}
            onPress={() =>
              setMovementLines((prev) => [
                ...prev,
                { ...newMovementLine(), tobaccoTareId: tares[0]?.id ?? null },
              ])
            }
          >
            <Text style={styles.addLineText}>+ Ещё позиция</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Комментарий (необязательно)</Text>
          <TextInput
            style={styles.commentInput}
            value={movementComment}
            placeholder="Например: поставка от 14.09"
            placeholderTextColor={colors.textMuted}
            multiline
            onChangeText={setMovementComment}
          />
        </ScrollView>
        <View style={styles.modalActions}>
          <Pressable style={styles.secondaryBtn} onPress={closeMovement} disabled={saving}>
            <Text style={styles.secondaryBtnText}>Отмена</Text>
          </Pressable>
          <Pressable style={styles.primaryBtn} onPress={submitMovement} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? '…' : 'Сохранить'}</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={stockWriteoffOpen}
        onRequestClose={() => !saving && setStockWriteoffOpen(false)}
      >
        <Text style={styles.modalTitle}>Списание остатка</Text>
        <Text style={styles.modalHint}>
          Сколько грамм списать со склада точки. Больше текущего остатка нельзя. Ввод — номпадом,
          без системной клавиатуры.
        </Text>

        <View style={styles.amountDisplay}>
          <Text style={styles.amountDisplayText}>{stockWriteoffAmount || '0'} г</Text>
        </View>
        <Keypad
          onKey={(key) =>
            setStockWriteoffAmount((prev) => applyKeypadDigit(prev || '0', key, { decimals: 3 }))
          }
        />

        <Text style={styles.fieldLabel}>Комментарий (необязательно)</Text>
        <TextInput
          style={styles.commentInput}
          value={stockWriteoffComment}
          placeholder="Например: меласса после переборки"
          placeholderTextColor={colors.textMuted}
          multiline
          onChangeText={setStockWriteoffComment}
        />

        <View style={styles.modalActions}>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => setStockWriteoffOpen(false)}
            disabled={saving}
          >
            <Text style={styles.secondaryBtnText}>Отмена</Text>
          </Pressable>
          <Pressable style={styles.primaryBtn} onPress={submitStockWriteoff} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? '…' : 'Списать'}</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell visible={countOpen} onRequestClose={() => !saving && setCountOpen(false)}>
        <Text style={styles.modalTitle}>Подсчёт табака</Text>
        <Text style={styles.modalHint}>Чистый вес сейчас: {formatG(totalNet)}</Text>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="handled"
        >
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
                    style={[styles.fieldInput, styles.fieldInputFlex]}
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
      </ModalShell>
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
  qtyValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
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
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionReceipt: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
  },
  actionWriteoff: {
    backgroundColor: colors.surface,
    borderColor: colors.danger || '#c44',
  },
  stockWriteoffBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  actionBtnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  actionBtnSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  screenPrimaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  modalBackdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalCard: {
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
    maxHeight: '90%',
    zIndex: 1,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  modalScroll: { flexGrow: 0, maxHeight: 360 },
  modalScrollContent: { gap: 12, paddingBottom: 8 },
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
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  removeLine: { color: colors.danger || '#c44', fontSize: 13, fontWeight: '600' },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  tareChips: { flexGrow: 0 },
  tareChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: colors.bg,
  },
  tareChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  tareChipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  tareChipTextActive: { color: '#fff' },
  tareChipMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  addLineBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addLineText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 20,
    fontWeight: '600',
  },
  fieldInputFull: {
    alignSelf: 'stretch',
    width: '100%',
  },
  fieldInputFlex: {
    flex: 1,
  },
  commentInput: {
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  amountDisplay: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: 'flex-end',
  },
  amountDisplayText: { color: colors.text, fontSize: 32, fontWeight: '700' },
  keypad: { gap: 8 },
  keypadRow: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.surface2 || '#24242a',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { opacity: 0.7, backgroundColor: colors.border },
  keyText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  addPartBtn: {
    width: 48,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  addPartText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  addPartSpacer: { width: 48 },
  modalActions: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
});
