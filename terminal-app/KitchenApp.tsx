import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from './src/theme/colors';
import {
  ApiRequestError,
  fetchKitchenBoard,
  markKitchenItemReady,
  type KitchenBoard,
  type Zone,
} from './src/api/client';
import { layoutTablesOnViewport, normalizeTableSize, snapToGrid, layoutSizeForTable } from './src/utils/tableLayout';
import { kitchenFinishedAt, kitchenTiming, moreUrgent, splitKitchenTickets, type KitchenTimingState } from './src/kitchen/timing';
import { playNewKitchenOrderSound } from './src/kitchen/sound';
import AppUpdateGate from './src/components/AppUpdateGate';
import UpdateCheckRow from './src/components/UpdateCheckRow';
import { requestUpdateCheck } from './src/services/updateEvents';

const VENUE_KEY = 'imperial-mc:kitchen-venue';
const HIDDEN_KEY = 'imperial-mc:kitchen-hidden';

const STATUS_COLORS: Record<string, string> = {
  free: colors.accent2,
  occupied: colors.danger,
  dirty: colors.textMuted,
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function modifierLine(mod: { name: string; qty: number; unit: string | null }): string {
  if (mod.qty > 0 && mod.unit) return `${mod.name} · ${mod.qty} ${mod.unit}`;
  return mod.name;
}

function Pulse({ style, color }: { style?: object; color?: string }) {
  const opacity = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View pointerEvents="none" style={[styles.pulse, style, color ? { backgroundColor: color } : null, { opacity }]} />;
}

function SwipeToDismiss({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const translateX = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
      onPanResponderMove: (_, gesture) => {
        translateX.setValue(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) > 72) {
          Animated.timing(translateX, {
            toValue: gesture.dx > 0 ? 520 : -520,
            duration: 140,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) onDismissRef.current();
          });
          return;
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeUnder}>
        <Text style={styles.swipeUnderText}>Убрать</Text>
        <Text style={styles.swipeUnderText}>Убрать</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

function KitchenRoot() {
  const insets = useSafeAreaInsets();
  const [venueId, setVenueId] = useState<number | null>(null);
  const [venues, setVenues] = useState<{ id: number; name: string; shiftOpen: boolean }[]>([]);
  const [board, setBoard] = useState<KitchenBoard | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [hiddenReady, setHiddenReady] = useState(false);
  const venueIdRef = useRef<number | null>(null);
  const seenTickets = useRef<Set<number> | null>(null);
  const seenVenue = useRef<number | null>(null);
  venueIdRef.current = venueId;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      let data;
      try {
        data = await fetchKitchenBoard(venueIdRef.current ?? undefined);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'KITCHEN_OFF' && venueIdRef.current) {
          venueIdRef.current = null;
          setVenueId(null);
          await AsyncStorage.removeItem(VENUE_KEY).catch(() => {});
          data = await fetchKitchenBoard();
        } else {
          throw err;
        }
      }
      setVenues(data.venues);
      setBoard(data.board);
      setError(null);
      if (data.board) {
        setZoneId((prev) => {
          if (prev != null && data.board?.zones.some((zone) => zone.id === prev)) return prev;
          return data.board?.zones[0]?.id ?? null;
        });
        if (venueIdRef.current == null) {
          setVenueId(data.board.venueId);
          void AsyncStorage.setItem(VENUE_KEY, String(data.board.venueId));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нет связи с кассой');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(HIDDEN_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        setHiddenIds(new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHiddenReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!board) return;
    if (seenVenue.current !== board.venueId) {
      seenVenue.current = board.venueId;
      seenTickets.current = new Set(board.tickets.map((ticket) => ticket.id));
      return;
    }
    const known = seenTickets.current ?? new Set<number>();
    const fresh = board.tickets.some((ticket) => !known.has(ticket.id));
    for (const ticket of board.tickets) known.add(ticket.id);
    seenTickets.current = known;
    if (fresh) playNewKitchenOrderSound();
  }, [board]);

  useEffect(() => {
    if (!board || !hiddenReady) return;
    const live = new Set(board.tickets.map((ticket) => ticket.id));
    setHiddenIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      void AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  }, [board, hiddenReady]);

  const hideTicket = (id: number) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      void AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await AsyncStorage.getItem(VENUE_KEY).catch(() => null);
      if (!cancelled && stored && Number(stored) > 0) {
        setVenueId(Number(stored));
        venueIdRef.current = Number(stored);
      }
      if (!cancelled) await load();
    })();
    const timer = setInterval(() => void load({ silent: true }), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  const chooseVenue = async (id: number) => {
    setVenueId(id);
    venueIdRef.current = id;
    await AsyncStorage.setItem(VENUE_KEY, String(id)).catch(() => {});
    await load();
  };

  const markItemReady = async (itemId: number) => {
    if (busyId) return;
    setBusyId(itemId);
    try {
      await markKitchenItemReady(itemId);
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить позицию');
    } finally {
      setBusyId(null);
    }
  };

  const zones: Zone[] = board?.zones ?? [];
  const zone = zones.find((item) => item.id === zoneId) ?? zones[0];
  const preparedTables =
    zone?.tables.map((table) => {
      const size = normalizeTableSize(table.size);
      const dims = layoutSizeForTable({ ...table, size });
      return {
        ...table,
        size,
        width: dims.width,
        height: dims.height,
        posX: snapToGrid(table.posX),
        posY: snapToGrid(table.posY),
      };
    }) ?? [];
  const layout =
    preparedTables.length > 0 && viewport.width > 0 && viewport.height > 0
      ? layoutTablesOnViewport(preparedTables, viewport.width, viewport.height)
      : null;

  const visibleTickets = hiddenReady
    ? (board?.tickets ?? []).filter((ticket) => !hiddenIds.has(ticket.id))
    : [];
  const ticketBands = splitKitchenTickets(visibleTickets, now);
  const newByTable = new Map<number, number>();
  const timingByTable = new Map<number, KitchenTimingState>();
  for (const ticket of visibleTickets) {
    const pending = ticket.items.some((item) => !item.ready);
    if (!ticket.tableId || !pending) continue;
    newByTable.set(ticket.tableId, (newByTable.get(ticket.tableId) || 0) + 1);
    const timing = kitchenTiming(new Date(ticket.createdAt).getTime(), now, true);
    timingByTable.set(ticket.tableId, moreUrgent(timingByTable.get(ticket.tableId), timing.state));
  }

  const renderTicket = (ticket: NonNullable<KitchenBoard>['tickets'][number]) => {
    const pending = ticket.items.some((item) => !item.ready);
    const readyCount = ticket.items.filter((item) => item.ready).length;
    const timing = kitchenTiming(
      new Date(ticket.createdAt).getTime(),
      now,
      pending,
      pending ? null : kitchenFinishedAt(ticket.readyAt, ticket.items.map((item) => item.readyAt))
    );
    const card = (
      <View
        style={[
          styles.card,
          pending && timing.state === 'ok' && styles.cardNew,
          timing.state === 'warn' && styles.cardWarn,
          timing.state === 'late' && styles.cardLate,
          !pending && styles.cardDone,
        ]}
      >
        {timing.state === 'late' ? <Pulse style={styles.cardPulse} color={colors.danger} /> : null}
        {timing.state === 'warn' ? <Pulse style={styles.cardPulse} color="#f0c14b" /> : null}
        {pending && timing.state === 'ok' ? <Pulse style={styles.cardPulse} /> : null}
        <View style={styles.cardTop}>
          <Text style={styles.cardTable}>{ticket.tableName}</Text>
          <Text style={styles.cardTime}>{formatTime(ticket.createdAt)}</Text>
        </View>
        <Text
          style={[
            styles.timer,
            timing.state === 'warn' && styles.timerWarn,
            timing.state === 'late' && styles.timerLate,
            timing.state === 'done' && styles.timerDone,
          ]}
        >
          {timing.label}
        </Text>
        <Text style={styles.cardGuest}>
          {ticket.guestLabel}
          {pending
            ? readyCount > 0
              ? ` · готово ${readyCount} из ${ticket.items.length}`
              : ' · новый'
            : ' · готов · смахните, чтобы убрать'}
        </Text>
        {ticket.items.map((item) => (
          <View key={item.id} style={[styles.itemBlock, item.ready && styles.itemReady]}>
            <View style={styles.itemRow}>
              <Text style={styles.itemName}>
                {item.qty}× {item.name}
              </Text>
              {item.ready ? (
                <Text style={styles.itemReadyLabel}>Готово</Text>
              ) : (
                <Pressable
                  style={styles.itemReadyButton}
                  disabled={busyId != null}
                  onPress={() => void markItemReady(item.id)}
                >
                  <Text style={styles.itemReadyButtonText}>{busyId === item.id ? '…' : 'Готово'}</Text>
                </Pressable>
              )}
            </View>
            {item.serveIn ? <Text style={styles.serveIn}>посуда: {item.serveIn}</Text> : null}
            {item.modifiers.map((mod, index) => (
              <Text key={`${item.id}-${index}`} style={styles.mod}>
                {modifierLine(mod)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
    if (pending) return <View key={ticket.id}>{card}</View>;
    return (
      <SwipeToDismiss key={ticket.id} onDismiss={() => hideTicket(ticket.id)}>
        {card}
      </SwipeToDismiss>
    );
  };

  if (loading && !board && venues.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (!board && venues.length > 1) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Кухня</Text>
        <Text style={styles.hint}>Выберите заведение, где на терминале включена кухня</Text>
        {venues.map((venue) => (
          <Pressable key={venue.id} style={styles.venueButton} onPress={() => void chooseVenue(venue.id)}>
            <Text style={styles.venueName}>{venue.name}</Text>
            <Text style={styles.hint}>{venue.shiftOpen ? 'Смена открыта' : 'Смена закрыта'}</Text>
          </Pressable>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Кухня</Text>
        </View>
        <UpdateCheckRow channel="kitchen" />
        <Text style={styles.venueTitle} numberOfLines={1}>
          {board?.venueName || 'Нет зала с включённой кухней'}
        </Text>
        {zones.length > 1 && zone ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.zones}>
            {zones.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.zoneChip, item.id === zone.id && styles.zoneChipOn]}
                onPress={() => setZoneId(item.id)}
              >
                <Text style={[styles.zoneChipText, item.id === zone.id && styles.zoneChipTextOn]}>{item.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      {!board ? (
        <View style={styles.center}>
          <Text style={styles.hint}>
            На терминале зала откройте шестерёнку и включите «Кухня». Заказы появятся из открытой смены этого терминала.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.floorWrap}>
            {board.shiftOpen ? null : (
              <Text style={styles.banner}>Смена закрыта — новые заказы не придут, пока её не откроют</Text>
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View
              style={styles.floor}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
              }}
            >
              {layout
                ? layout.tables.map((table) => {
                    const fresh = newByTable.get(table.id) || 0;
                    const timing = timingByTable.get(table.id);
                    const urgent = timing === 'late' || timing === 'warn';
                    const borderColor =
                      timing === 'late'
                        ? colors.danger
                        : timing === 'warn'
                          ? '#f0c14b'
                          : fresh
                            ? colors.accent2
                            : STATUS_COLORS[table.status] || colors.border;
                    return (
                      <View
                        key={table.id}
                        style={[
                          styles.tile,
                          {
                            left: table.left,
                            top: table.top,
                            width: table.tileWidth,
                            height: table.tileHeight,
                            borderColor,
                          },
                        ]}
                      >
                        {timing === 'late' ? <Pulse color={colors.danger} /> : null}
                        {timing === 'warn' ? <Pulse color="#f0c14b" /> : null}
                        {!urgent && fresh ? <Pulse /> : null}
                        <Text style={styles.tileName} numberOfLines={2}>
                          {table.name}
                        </Text>
                        <Text style={[styles.tileMeta, timing === 'late' && styles.tileLate, timing === 'warn' && styles.tileWarn]}>
                          {timing === 'late'
                            ? 'сверх 20 мин'
                            : timing === 'warn'
                              ? 'время выходит'
                              : fresh
                                ? `${fresh} новых`
                                : `${table.capacity} мест`}
                        </Text>
                      </View>
                    );
                  })
                : (
                  <View style={styles.center}>
                    <Text style={styles.hint}>В этой зоне нет столов</Text>
                  </View>
                )}
            </View>
          </View>
          <View style={styles.list}>
            <Text style={styles.listTitle}>Заказы</Text>
            <ScrollView contentContainerStyle={styles.listContent}>
              {ticketBands.active.map((ticket) => renderTicket(ticket))}
              {ticketBands.sunk.length ? <Text style={styles.sunkTitle}>Готовые</Text> : null}
              {ticketBands.sunk.map((ticket) => renderTicket(ticket))}
              {hiddenReady && !visibleTickets.length ? (
                <Text style={styles.hint}>Пока ничего не отправили на кухню</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

export default function KitchenApp() {
  useEffect(() => {
    const timer = setInterval(() => requestUpdateCheck(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <KitchenRoot />
      <AppUpdateGate autoCheck channel="kitchen" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  venueTitle: { color: colors.textMuted, fontSize: 14 },
  hint: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8, textAlign: 'center' },
  banner: {
    color: '#f0c14b',
    backgroundColor: 'rgba(240,193,75,0.12)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  body: { flex: 1, flexDirection: 'row' },
  floorWrap: { flex: 1.5, paddingLeft: 12, paddingRight: 8, paddingBottom: 12 },
  floor: {
    flex: 1,
    position: 'relative',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tile: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 4,
  },
  tileName: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  tileMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontWeight: '700' },
  tileWarn: { color: '#ffe08a' },
  tileLate: { color: '#ffb4b4' },
  pulse: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.accent2,
  },
  list: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  listTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  listContent: { paddingBottom: 16, gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    overflow: 'hidden',
  },
  cardNew: { borderColor: colors.accent2 },
  cardDone: { borderColor: '#6ee7a8' },
  sunkTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: 4 },
  swipeWrap: { position: 'relative' },
  swipeUnder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.danger,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  swipeUnderText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardWarn: {
    borderWidth: 2,
    borderColor: '#f0c14b',
    backgroundColor: 'rgba(240, 193, 75, 0.22)',
  },
  cardLate: {
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: 'rgba(225, 76, 76, 0.28)',
  },
  cardPulse: { borderRadius: 12 },
  timer: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 4 },
  timerWarn: { color: '#ffe08a', fontSize: 20 },
  timerLate: { color: '#ffd0d0', fontSize: 20 },
  timerDone: { color: '#6ee7a8', fontSize: 14, fontWeight: '700' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTable: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardTime: { color: colors.textMuted, fontSize: 12 },
  cardGuest: { color: colors.accent2, fontSize: 12, marginTop: 2, marginBottom: 6 },
  itemBlock: { marginBottom: 8 },
  itemReady: {
    borderWidth: 1,
    borderColor: '#6ee7a8',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { color: colors.text, fontSize: 15, flex: 1 },
  serveIn: { color: colors.accent2, fontSize: 13, fontWeight: '700', marginLeft: 8, marginTop: 2 },
  mod: { color: colors.textMuted, fontSize: 12, marginLeft: 8, marginTop: 2 },
  itemReadyButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  itemReadyButtonText: { color: '#f1f1f3', fontSize: 14, fontWeight: '700' },
  itemReadyLabel: { color: '#6ee7a8', fontSize: 13, fontWeight: '700' },
  zones: { gap: 8, paddingVertical: 6 },
  zoneChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  zoneChipOn: { backgroundColor: colors.accent, borderColor: colors.accent2 },
  zoneChipText: { color: colors.textMuted, fontSize: 13 },
  zoneChipTextOn: { color: '#f1f1f3', fontWeight: '700' },
  venueButton: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
  },
  venueName: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
