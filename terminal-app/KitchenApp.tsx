import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
  markKitchenTicketReady,
  type KitchenBoard,
  type KitchenTicket,
  type Zone,
} from './src/api/client';
import { layoutTablesOnViewport, normalizeTableSize, snapToGrid, layoutSizeForTable } from './src/utils/tableLayout';

const VENUE_KEY = 'imperial-mc:kitchen-venue';

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

function Pulse({ style }: { style?: object }) {
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
  return <Animated.View pointerEvents="none" style={[styles.pulse, style, { opacity }]} />;
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
  const venueIdRef = useRef<number | null>(null);
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

  const markReady = async (ticket: KitchenTicket) => {
    if (busyId || ticket.status === 'ready') return;
    setBusyId(ticket.id);
    try {
      await markKitchenTicketReady(ticket.id);
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить готовность');
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

  const newByTable = new Map<number, number>();
  for (const ticket of board?.tickets ?? []) {
    if (ticket.status === 'new' && ticket.tableId) {
      newByTable.set(ticket.tableId, (newByTable.get(ticket.tableId) || 0) + 1);
    }
  }

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
        <Text style={styles.title}>Кухня</Text>
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
                            borderColor: fresh ? colors.accent2 : STATUS_COLORS[table.status] || colors.border,
                          },
                        ]}
                      >
                        {fresh ? <Pulse /> : null}
                        <Text style={styles.tileName} numberOfLines={2}>
                          {table.name}
                        </Text>
                        <Text style={styles.tileMeta}>{fresh ? `${fresh} новых` : `${table.capacity} мест`}</Text>
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
              {(board.tickets.length ? board.tickets : []).map((ticket) => {
                const isNew = ticket.status === 'new';
                return (
                  <View key={ticket.id} style={[styles.card, isNew && styles.cardNew]}>
                    {isNew ? <Pulse style={styles.cardPulse} /> : null}
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTable}>{ticket.tableName}</Text>
                      <Text style={styles.cardTime}>{formatTime(ticket.createdAt)}</Text>
                    </View>
                    <Text style={styles.cardGuest}>
                      {ticket.guestLabel}
                      {isNew ? ' · новый' : ' · готов'}
                    </Text>
                    {ticket.items.map((item) => (
                      <View key={item.id} style={styles.itemBlock}>
                        <Text style={styles.itemName}>
                          {item.qty}× {item.name}
                        </Text>
                        {item.modifiers.map((mod, index) => (
                          <Text key={`${item.id}-${index}`} style={styles.mod}>
                            {modifierLine(mod)}
                          </Text>
                        ))}
                      </View>
                    ))}
                    {isNew ? (
                      <Pressable
                        style={styles.readyButton}
                        disabled={busyId === ticket.id}
                        onPress={() => void markReady(ticket)}
                      >
                        <Text style={styles.readyText}>
                          {busyId === ticket.id ? 'Отмечаем…' : 'Готово'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.readyDone}>Отмечено готовым</Text>
                    )}
                  </View>
                );
              })}
              {!board.tickets.length ? <Text style={styles.hint}>Пока ничего не отправили на кухню</Text> : null}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

export default function KitchenApp() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <KitchenRoot />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 4 },
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
  tileMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
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
  cardPulse: { borderRadius: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTable: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardTime: { color: colors.textMuted, fontSize: 12 },
  cardGuest: { color: colors.accent2, fontSize: 12, marginTop: 2, marginBottom: 6 },
  itemBlock: { marginBottom: 4 },
  itemName: { color: colors.text, fontSize: 15 },
  mod: { color: colors.textMuted, fontSize: 12, marginLeft: 8 },
  readyButton: {
    marginTop: 10,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  readyText: { color: '#f1f1f3', fontSize: 16, fontWeight: '700' },
  readyDone: { color: '#6ee7a8', fontSize: 13, marginTop: 8, fontWeight: '600' },
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
