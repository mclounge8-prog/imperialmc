import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import { fetchTables, fetchOpenOrders, fetchPaidReceipts } from '../api/client';
import type { OpenOrderSummary, PaidReceiptSummary, Zone } from '../api/client';
import PaidReceiptDetailModal from '../components/PaidReceiptDetailModal';
import ScreenSwipeHost from '../components/ScreenSwipeHost';
import { fitFloorPlan, normalizeTableSize } from '../utils/tableLayout';
import type { RootStackParamList } from '../../App';

const STATUS_LABELS: Record<string, string> = {
  free: 'Свободен',
  occupied: 'Занят',
  dirty: 'Грязный',
};

const STATUS_COLORS: Record<string, string> = {
  free: colors.accent2,
  occupied: colors.danger,
  dirty: colors.textMuted,
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GRADIENT_BLUE: [string, string] = [colors.accent, colors.accent2];

export default function TablesScreen() {
  const { session } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrderSummary[]>([]);
  const [paidReceipts, setPaidReceipts] = useState<PaidReceiptSummary[]>([]);
  const [ordersTab, setOrdersTab] = useState<'open' | 'paid'>('open');
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [floorArea, setFloorArea] = useState({ width: 0, height: 0 });
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!session || !venue) return;
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const [tablesData, ordersData, paidData] = await Promise.all([
          fetchTables(venue.id, session.token),
          fetchOpenOrders(venue.id, session.token),
          fetchPaidReceipts(venue.id, session.token),
        ]);
        const nextZones = tablesData.zones.map((zone) => ({
          ...zone,
          tables: zone.tables.map((table) => ({
            ...table,
            size: normalizeTableSize(table.size),
          })),
        }));
        setZones(nextZones);
        setSelectedZoneId((prev) => {
          if (prev != null && nextZones.some((z) => z.id === prev)) return prev;
          return nextZones[0]?.id ?? null;
        });
        setOpenOrders(ordersData.orders);
        setPaidReceipts(paidData);
        hasLoadedRef.current = true;
        if (silent) setError(null);
      } catch (e) {
        if (!silent) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить столы');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [session, venue]
  );

  useFocusEffect(
    useCallback(() => {
      void load({ silent: hasLoadedRef.current });
    }, [load])
  );

  const goToPrevZone = useCallback(() => {
    setSelectedZoneId((prev) => {
      if (zones.length === 0) return prev;
      const idx = zones.findIndex((z) => z.id === prev);
      const nextIdx = idx <= 0 ? zones.length - 1 : idx - 1;
      return zones[nextIdx].id;
    });
  }, [zones]);

  const goToNextZone = useCallback(() => {
    setSelectedZoneId((prev) => {
      if (zones.length === 0) return prev;
      const idx = zones.findIndex((z) => z.id === prev);
      const nextIdx = idx === -1 || idx >= zones.length - 1 ? 0 : idx + 1;
      return zones[nextIdx].id;
    });
  }, [zones]);

  useLayoutEffect(() => {
    const currentZone = zones.find((z) => z.id === selectedZoneId) ?? zones[0];

    navigation.setOptions({
      headerTitleAlign: 'center',
      headerLeft: () => (
        <Text style={styles.headerAppTitle} numberOfLines={1}>
          Music Community Terminal
        </Text>
      ),
      headerTitle: () =>
        currentZone ? (
          <View style={styles.zoneSwitcher}>
            <Pressable
              style={[styles.zoneArrowButton, zones.length <= 1 && styles.zoneArrowButtonDisabled]}
              onPress={goToPrevZone}
              disabled={zones.length <= 1}
              hitSlop={6}
            >
              <Text style={[styles.zoneArrow, zones.length <= 1 && styles.zoneArrowDisabled]}>‹</Text>
            </Pressable>
            <Text style={styles.zoneName} numberOfLines={1}>
              {currentZone.name}
            </Text>
            <Pressable
              style={[styles.zoneArrowButton, zones.length <= 1 && styles.zoneArrowButtonDisabled]}
              onPress={goToNextZone}
              disabled={zones.length <= 1}
              hitSlop={6}
            >
              <Text style={[styles.zoneArrow, zones.length <= 1 && styles.zoneArrowDisabled]}>›</Text>
            </Pressable>
          </View>
        ) : null,
    });
  }, [navigation, zones, selectedZoneId, goToPrevZone, goToNextZone]);

  const handleQuickOrder = () => {
    navigation.navigate('Order', { tableId: null, tableName: 'Быстрый заказ' });
  };

  const handleTablePress = (tableId: number, tableName: string) => {
    navigation.navigate('Order', { tableId, tableName });
  };

  const handleOpenOrderPress = (order: OpenOrderSummary) => {
    navigation.navigate('Order', {
      orderId: order.id,
      tableId: order.tableId,
      tableName: order.tableName ?? `Быстрый заказ №${order.id}`,
    });
  };

  if (loading) {
    return (
      <ScreenSwipeHost screen="Tables">
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent2} size="large" />
        </View>
      </ScreenSwipeHost>
    );
  }

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? zones[0];
  const fitted =
    selectedZone && selectedZone.tables.length > 0 && floorArea.width > 0 && floorArea.height > 0
      ? fitFloorPlan(selectedZone.tables, floorArea.width, floorArea.height)
      : null;

  return (
    <ScreenSwipeHost screen="Tables">
    <View style={styles.container}>
      <View style={styles.leftPane}>
        <Pressable style={styles.quickOrderWrapper} onPress={handleQuickOrder}>
          <LinearGradient
            colors={GRADIENT_BLUE}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.quickOrderButton}
          >
            <Text style={styles.quickOrderText}>⚡ Быстрый заказ</Text>
          </LinearGradient>
        </Pressable>

        {error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : zones.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Зоны пока не заведены в бэкофисе</Text>
          </View>
        ) : (
          <View
            style={styles.floorArea}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setFloorArea((prev) =>
                prev.width === width && prev.height === height ? prev : { width, height }
              );
            }}
          >
            {!selectedZone || selectedZone.tables.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>В этой зоне пока нет столов</Text>
              </View>
            ) : fitted ? (
              <View
                style={[
                  styles.floorPlan,
                  { width: fitted.planWidth, height: fitted.planHeight },
                ]}
              >
                {fitted.tables.map((table) => {
                  const fontScale = Math.max(0.7, Math.min(1.25, fitted.scale));
                  return (
                    <Pressable
                      key={table.id}
                      style={[
                        styles.tableTile,
                        {
                          left: table.left,
                          top: table.top,
                          width: table.tileWidth,
                          height: table.tileHeight,
                          borderColor: STATUS_COLORS[table.status],
                        },
                      ]}
                      onPress={() => handleTablePress(table.id, table.name)}
                    >
                      <Text
                        style={[styles.tileName, { fontSize: Math.round(13 * fontScale) }]}
                        numberOfLines={2}
                      >
                        {table.name}
                      </Text>
                      <Text
                        style={[styles.tileCapacity, { fontSize: Math.round(11 * fontScale) }]}
                      >
                        {table.capacity} мест
                      </Text>
                      <Text
                        style={[
                          styles.tileStatus,
                          {
                            color: STATUS_COLORS[table.status],
                            fontSize: Math.round(11 * fontScale),
                          },
                        ]}
                      >
                        {STATUS_LABELS[table.status] || table.status}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={[styles.ordersPane, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.ordersTabBar}>
          <Pressable
            style={[styles.ordersTabButton, ordersTab === 'open' && styles.ordersTabButtonActive]}
            onPress={() => setOrdersTab('open')}
          >
            <Text style={[styles.ordersTabText, ordersTab === 'open' && styles.ordersTabTextActive]}>
              Открытые
            </Text>
          </Pressable>
          <Pressable
            style={[styles.ordersTabButton, ordersTab === 'paid' && styles.ordersTabButtonActive]}
            onPress={() => setOrdersTab('paid')}
          >
            <Text style={[styles.ordersTabText, ordersTab === 'paid' && styles.ordersTabTextActive]}>
              Оплаченные
            </Text>
          </Pressable>
        </View>

        {ordersTab === 'open' ? (
          openOrders.length === 0 ? (
            <Text style={styles.emptyText}>Нет открытых заказов</Text>
          ) : (
            <ScrollView>
              {openOrders.map((o) => (
                <Pressable
                  key={o.id}
                  style={styles.openOrderRow}
                  onPress={() => handleOpenOrderPress(o)}
                >
                  <Text style={styles.openOrderName} numberOfLines={1}>
                    {o.tableName ?? `Быстрый заказ №${o.id}`}
                  </Text>
                  <Text style={styles.openOrderTotal}>{o.total.toFixed(0)} ₽</Text>
                </Pressable>
              ))}
            </ScrollView>
          )
        ) : paidReceipts.length === 0 ? (
          <Text style={styles.emptyText}>Сегодня пока нет оплаченных чеков</Text>
        ) : (
          <ScrollView>
            {paidReceipts.map((r) => (
              <Pressable
                key={r.id}
                style={styles.paidReceiptRow}
                onPress={() => setSelectedReceiptId(r.id)}
              >
                <View style={styles.paidReceiptInfo}>
                  <Text style={styles.openOrderName} numberOfLines={1}>
                    {r.tableName ?? 'Быстрый заказ'}
                    {r.guestLabel ? ` · ${r.guestLabel}` : ''}
                  </Text>
                  <Text style={styles.paidReceiptTime}>{formatReceiptTime(r.closedAt)}</Text>
                </View>
                <Text style={styles.openOrderTotal}>{r.total.toFixed(0)} ₽</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <PaidReceiptDetailModal
        receiptId={selectedReceiptId}
        token={session?.token ?? ''}
        onClose={() => setSelectedReceiptId(null)}
      />
    </View>
    </ScreenSwipeHost>
  );
}

function formatReceiptTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryText: { color: colors.text, fontSize: 14 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', padding: 16 },

  leftPane: { flex: 1.6 },
  quickOrderWrapper: { width: '100%', marginTop: 16, paddingHorizontal: 16 },
  quickOrderButton: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  quickOrderText: { color: '#f1f1f3', fontSize: 16, fontWeight: '700' },

  floorArea: {
    flex: 1,
    marginLeft: 16,
    marginRight: 8,
    marginTop: 12,
    marginBottom: 8,
    minHeight: 120,
  },
  floorPlan: {
    position: 'relative',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableTile: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  tileName: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  tileCapacity: { color: colors.textMuted, fontSize: 11 },
  tileStatus: { fontSize: 11, fontWeight: '500' },

  ordersPane: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    padding: 16,
  },
  ordersTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  ordersTabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  ordersTabButtonActive: { backgroundColor: colors.accent },
  ordersTabText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  ordersTabTextActive: { color: '#f1f1f3' },
  paidReceiptRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  paidReceiptInfo: { flex: 1 },
  paidReceiptTime: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  openOrderRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  openOrderName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  openOrderTotal: { color: colors.accent2, fontSize: 14, fontWeight: '600' },

  headerAppTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginLeft: 12 },
  zoneSwitcher: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  zoneArrowButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneArrowButtonDisabled: { opacity: 0.4 },
  zoneArrow: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 24 },
  zoneArrowDisabled: { color: colors.textMuted },
  zoneName: { color: colors.text, fontSize: 15, fontWeight: '600', minWidth: 80, textAlign: 'center' },
});
