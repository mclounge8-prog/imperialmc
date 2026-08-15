import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { ICON_BUTTON_SIZE } from '../theme/sizes';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';
import MenuBrowser from '../components/MenuBrowser';
import CompositionModal from '../components/CompositionModal';
import type { CompositionTarget } from '../components/CompositionModal';
import ItemCustomizeModal from '../components/ItemCustomizeModal';
import {
  fetchMenu,
  fetchTables,
  getOrCreateTableOrder,
  fetchOrderById,
  createQuickOrder,
  addGuest,
  addOrderItem,
  removeOrderItem,
  deleteOrderItemFully,
  moveOrderItem,
  transferOrderTable,
  payGuest,
  setGuestDiscount,
  cancelGuest,
  printGuestPrecheck,
  fetchCurrentShift,
} from '../api/client';
import { runPendingFiscalJobs } from '../services/fiscalWorker';
import CommentPromptModal from '../components/CommentPromptModal';
import type { DiscountPercent, MenuItem, MenuResponse, Order, OrderGuest, OrderItem, PaymentMethod, Zone } from '../api/client';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

type MoveTarget = {
  itemId: number;
  itemName: string;
  currentGuestId: number;
};

type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertState = {
  title: string;
  message: string;
  buttons: AlertButton[];
} | null;

// Единый синий градиент вместо разноцветной палитры — категории и ключевые кнопки
// выдержаны в одной айдентике, не в стандартных системных цветах
const GRADIENT_BLUE: [string, string] = [colors.accent, colors.accent2];

// Свой экранный номпад для суммы наличных — никаких системных Android-клавиатур,
// весь ввод в приложении должен быть в нашей теме
const CASH_KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

const DISCOUNT_OPTIONS: DiscountPercent[] = [0, 10, 15, 20, 25, 100];

function roundMoney(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

export default function OrderScreen({ route, navigation }: Props) {
  const { orderId, tableId, tableName } = route.params;
  const { session } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferZones, setTransferZones] = useState<Zone[] | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<OrderGuest | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [cashEntryMode, setCashEntryMode] = useState(false);
  const [cashReceivedText, setCashReceivedText] = useState('');
  const [discountGuest, setDiscountGuest] = useState<OrderGuest | null>(null);
  const [discountDraft, setDiscountDraft] = useState<DiscountPercent>(0);
  const [discountBusy, setDiscountBusy] = useState(false);
  const [compositionTarget, setCompositionTarget] = useState<CompositionTarget>(null);
  const [customizeTarget, setCustomizeTarget] = useState<MenuItem | null>(null);
  const [cancelCommentGuest, setCancelCommentGuest] = useState<OrderGuest | null>(null);

  const showAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    setAlertState({ title, message, buttons: buttons ?? [{ text: 'ОК' }] });
  }, []);

  const load = useCallback(async () => {
    if (!session || !venue) return;
    setLoading(true);
    setError(null);
    try {
      const [menuData, orderData] = await Promise.all([
        fetchMenu(venue.id, session.token),
        orderId != null
          ? fetchOrderById(orderId, session.token)
          : tableId != null
            ? getOrCreateTableOrder(tableId, session.token)
            : createQuickOrder(venue.id, session.token),
      ]);

      setMenu(menuData);
      setOrder(orderData);
      setSelectedGuestId((prev) => prev ?? orderData.guests[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить заказ');
    } finally {
      setLoading(false);
    }
    // orderId/tableId намеренно не в зависимостях повторно — экран открывается заново на каждый заказ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, venue]);

  useEffect(() => {
    load();
  }, [load]);

  // После рестарта OTA / возврата на экран — подтянуть актуальный состав с сервера.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (!session || !venue) return;
      void (async () => {
        try {
          const id = orderId ?? order?.id;
          if (id == null) return;
          const fresh = await fetchOrderById(id, session.token);
          setOrder(fresh);
          setSelectedGuestId((prev) => {
            if (prev && fresh.guests.some((g) => g.id === prev)) return prev;
            return fresh.guests[0]?.id ?? null;
          });
        } catch {
          /* не шумим — пользователь уже в заказе */
        }
      })();
    });
    return unsub;
  }, [navigation, session, venue, orderId, order?.id]);

  const handleAddGuest = async () => {
    if (!session || !order || busy) return;
    setBusy(true);
    try {
      const updated = await addGuest(order.id, session.token);
      setOrder(updated);
      const newGuest = updated.guests[updated.guests.length - 1];
      if (newGuest) setSelectedGuestId(newGuest.id);
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось добавить гостя');
    } finally {
      setBusy(false);
    }
  };

  const handleAddItem = async (menuItemId: number, guestId?: number, modifierIds?: number[]) => {
    const targetGuestId = guestId ?? selectedGuestId;
    if (!session || !order || !targetGuestId || busy) return;
    const guest = order.guests.find((g) => g.id === targetGuestId);
    if (guest?.precheckPrintedAt) {
      showAlert('Пречек напечатан', 'Состав чека зафиксирован. Можно только оплатить или отменить с комментарием.');
      return;
    }
    setBusy(true);
    try {
      const updated = await addOrderItem(order.id, menuItemId, targetGuestId, session.token, modifierIds);
      setOrder(updated);
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось добавить позицию');
    } finally {
      setBusy(false);
    }
  };

  // Тап по позиции меню: если у неё есть модификаторы (хоть обычные
  // ингредиенты, хоть платные добавки) — сначала спрашиваем состав, чтобы
  // можно было снять/добавить прямо сейчас, а не создавать отдельную позицию
  // меню под каждое сочетание. Если модификаторов нет вообще — добавляем
  // сразу, без лишнего экрана.
  const handleMenuItemPress = (item: MenuItem) => {
    if (item.modifierGroups.length === 0) {
      handleAddItem(item.id);
      return;
    }
    setCustomizeTarget(item);
  };

  const handleConfirmCustomize = (modifierIds: number[]) => {
    if (!customizeTarget) return;
    handleAddItem(customizeTarget.id, undefined, modifierIds);
    setCustomizeTarget(null);
  };

  // "+" на уже добавленной позиции — плюсует количество с ТЕМ ЖЕ составом,
  // что уже выбран в этой строке, а не открывает настройку заново
  const handleRepeatItem = (item: OrderItem, guestId: number) => {
    if (!item.menuItemId) return;
    const modifierIds = item.modifiers
      .map((m) => m.modifierId)
      .filter((id): id is number => id !== null);
    handleAddItem(item.menuItemId, guestId, modifierIds);
  };

  // Показывает, что реально отличается от дефолтного состава блюда — какие
  // ингредиенты сняты, какие платные добавки включены. Именно это решает
  // задачу "шаурма без огурцов + картофель фри" без создания отдельной позиции.
  const buildModifierSummary = (item: OrderItem): string => {
    const flattenCats = (cats: NonNullable<typeof menu>['categories']): MenuItem[] =>
      cats.flatMap((c) => [...c.items, ...flattenCats(c.children || [])]);
    const menuItem = menu
      ? [...flattenCats(menu.categories), ...menu.uncategorized].find((mi) => mi.id === item.menuItemId)
      : undefined;
    if (!menuItem) {
      return item.modifiers.map((m) => m.name).join(', ');
    }
    const appliedIds = new Set(item.modifiers.map((m) => m.modifierId));
    const removed: string[] = [];
    const added: string[] = [];
    for (const group of menuItem.modifierGroups) {
      for (const opt of group.options) {
        const isApplied = appliedIds.has(opt.modifierId);
        if (opt.isDefault && !isApplied) removed.push(opt.name);
        if (!opt.isDefault && isApplied) added.push(opt.name);
      }
    }
    const parts: string[] = [];
    if (removed.length > 0) parts.push(`без: ${removed.join(', ')}`);
    if (added.length > 0) parts.push(`+ ${added.join(', ')}`);
    return parts.join(' · ');
  };

  const handleRemoveItem = async (itemId: number) => {
    if (!session || !order || busy) return;
    setBusy(true);
    try {
      const updated = await removeOrderItem(order.id, itemId, session.token);
      setOrder(updated);
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось убрать позицию');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteItemFully = (itemId: number, itemName: string) => {
    if (!order) return;
    showAlert('Удалить позицию', `Убрать «${itemName}» из чека полностью?`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          if (!session) return;
          setBusy(true);
          try {
            const updated = await deleteOrderItemFully(order.id, itemId, session.token);
            setOrder(updated);
          } catch (e) {
            showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось удалить позицию');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleConfirmMove = async (targetGuestId: number) => {
    if (!session || !order || !moveTarget) return;
    setBusy(true);
    setMoveTarget(null);
    try {
      const updated = await moveOrderItem(order.id, moveTarget.itemId, targetGuestId, session.token);
      setOrder(updated);
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось перенести позицию');
    } finally {
      setBusy(false);
    }
  };

  const openTransferModal = async () => {
    if (!session || !venue) return;
    setTransferOpen(true);
    setTransferLoading(true);
    try {
      const data = await fetchTables(venue.id, session.token);
      setTransferZones(data.zones);
    } catch (e) {
      setTransferOpen(false);
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось загрузить список столов');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleTransfer = async (newTableId: number, newTableName: string) => {
    if (!session || !order) return;
    setTransferOpen(false);
    setBusy(true);
    try {
      const updated = await transferOrderTable(order.id, newTableId, session.token);
      setOrder(updated);
      navigation.setParams({ tableId: newTableId, tableName: newTableName });
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось пересадить');
    } finally {
      setBusy(false);
    }
  };

  const closePaymentModal = () => {
    setPaymentTarget(null);
    setCashEntryMode(false);
    setCashReceivedText('');
  };

  const openDiscountModal = () => {
    if (!order) return;
    const guest = order.guests.find((g) => g.id === selectedGuestId) ?? order.guests[0];
    if (!guest) return;
    if (guest.precheckPrintedAt) {
      showAlert('Пречек напечатан', 'После пречека скидку менять нельзя.');
      return;
    }
    const guestSubtotal = guest.subtotal ?? guest.total;
    if (guestSubtotal <= 0) {
      showAlert('Пустой чек', 'Сначала добавьте позиции гостю');
      return;
    }
    setDiscountDraft((guest.discountPercent as DiscountPercent) || 0);
    setDiscountGuest(guest);
  };

  const confirmGuestDiscount = async () => {
    if (!session || !order || !discountGuest) return;
    setDiscountBusy(true);
    try {
      const updated = await setGuestDiscount(
        order.id,
        discountGuest.id,
        discountDraft,
        session.token
      );
      setOrder(updated);
      setDiscountGuest(null);
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось сохранить скидку');
    } finally {
      setDiscountBusy(false);
    }
  };

  const handleCashKeyPress = (key: string) => {
    if (key === '⌫') {
      setCashReceivedText((prev) => prev.slice(0, -1));
      return;
    }
    if (key === '.') {
      setCashReceivedText((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : `${prev}.`));
      return;
    }
    setCashReceivedText((prev) => {
      // Не даём вводить больше двух знаков после запятой — это деньги, а не текст
      const dotIndex = prev.indexOf('.');
      if (dotIndex !== -1 && prev.length - dotIndex > 2) return prev;
      if (prev === '0') return key;
      return prev + key;
    });
  };

  const ensureShiftOpen = async (guestTotal = 0): Promise<boolean> => {
    // Нулевой чек можно закрыть без смены
    if (Number(guestTotal) <= 0.009) return true;
    if (!session || !venue) {
      showAlert('Смена не открыта', 'Смена не открыта — закрыть стол или провести оплату нельзя.');
      return false;
    }
    try {
      const shift = await fetchCurrentShift(venue.id, session.token);
      if (!shift) {
        showAlert('Смена не открыта', 'Смена не открыта — закрыть стол или провести оплату нельзя.');
        return false;
      }
      return true;
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось проверить смену');
      return false;
    }
  };

  const handlePay = async () => {
    if (!order) return;
    const guest = order.guests.find((g) => g.id === selectedGuestId) ?? order.guests[0];
    if (!guest) return;
    const guestSubtotal = guest.subtotal ?? guest.total;
    if (order.precheckEnabled && guestSubtotal > 0 && !guest.precheckPrintedAt) {
      showAlert('Нужен пречек', 'Сначала напечатайте пречек, затем проводите оплату.');
      return;
    }
    if (!(await ensureShiftOpen(guest.total))) return;
    setPaymentTarget(guest);
  };

  const handlePrecheck = async () => {
    if (!session || !order) return;
    const guest = order.guests.find((g) => g.id === selectedGuestId) ?? order.guests[0];
    if (!guest) return;
    const guestSubtotal = guest.subtotal ?? guest.total;
    if (guestSubtotal <= 0) {
      showAlert('Пустой чек', 'Добавьте позиции перед печатью пречека');
      return;
    }
    if (guest.precheckPrintedAt) {
      showAlert('Уже напечатан', 'Пречек по этому чеку уже был напечатан');
      return;
    }
    setBusy(true);
    try {
      const updated = await printGuestPrecheck(order.id, guest.id, session.token);
      setOrder(updated);
      if (venue) runPendingFiscalJobs(venue.id, session.token);
      const pct = guest.discountPercent || 0;
      showAlert(
        'Пречек',
        pct > 0
          ? `Состав зафиксирован со скидкой ${pct}%. Печать ушла на кассу (если АТОЛ включён).`
          : 'Состав зафиксирован. Печать ушла на кассу (если АТОЛ включён).'
      );
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось напечатать пречек');
    } finally {
      setBusy(false);
    }
  };

  const payableAmount = paymentTarget ? roundMoney(paymentTarget.total) : 0;
  const paymentSubtotal = paymentTarget
    ? roundMoney(paymentTarget.subtotal ?? paymentTarget.total)
    : 0;
  const paymentDiscountPct = paymentTarget?.discountPercent
    ? Number(paymentTarget.discountPercent)
    : 0;
  const paymentDiscountAmount = paymentTarget
    ? roundMoney(paymentTarget.discountAmount ?? paymentSubtotal - payableAmount)
    : 0;
  const cashReceivedAmount = parseFloat(cashReceivedText.replace(',', '.')) || 0;
  const changeAmount = cashReceivedAmount - payableAmount;
  const canConfirmCash = paymentTarget != null && cashReceivedAmount >= payableAmount - 0.001;

  const confirmPayment = async (method: PaymentMethod) => {
    if (!session || !order || !paymentTarget) return;
    if (!(await ensureShiftOpen(payableAmount))) {
      closePaymentModal();
      return;
    }
    const guest = paymentTarget;
    setPaymentBusy(true);
    try {
      const updated = await payGuest(order.id, guest.id, method, payableAmount, session.token);
      closePaymentModal();
      if (venue && payableAmount > 0.009) runPendingFiscalJobs(venue.id, session.token);
      if (updated.guests.length === 0) {
        navigation.goBack();
      } else {
        setOrder(updated);
        setSelectedGuestId(updated.guests[0].id);
      }
    } catch (e) {
      closePaymentModal();
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось провести оплату');
    } finally {
      setPaymentBusy(false);
    }
  };

  const confirmComplimentary = async () => {
    if (!session || !order || !paymentTarget || paymentDiscountPct !== 100) return;
    if (!(await ensureShiftOpen(0))) {
      closePaymentModal();
      return;
    }
    const guest = paymentTarget;
    setPaymentBusy(true);
    try {
      const updated = await payGuest(order.id, guest.id, 'cash', 0, session.token);
      closePaymentModal();
      if (updated.guests.length === 0) {
        navigation.goBack();
      } else {
        setOrder(updated);
        setSelectedGuestId(updated.guests[0].id);
      }
    } catch (e) {
      closePaymentModal();
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось провести оплату');
    } finally {
      setPaymentBusy(false);
    }
  };

  const performCancel = async (guest: OrderGuest, comment?: string) => {
    if (!session || !order) return;
    setBusy(true);
    try {
      const updated = await cancelGuest(order.id, guest.id, session.token, comment);
      setCancelCommentGuest(null);
      if (updated.guests.length === 0) {
        navigation.goBack();
      } else {
        setOrder(updated);
        setSelectedGuestId(updated.guests[0].id);
      }
    } catch (e) {
      showAlert('Ошибка', e instanceof Error ? e.message : 'Не удалось закрыть чек');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!order) return;
    const guest = order.guests.find((g) => g.id === selectedGuestId) ?? order.guests[0];
    if (!guest) return;
    if (!(await ensureShiftOpen(guest.total))) return;

    if (guest.precheckPrintedAt) {
      setCancelCommentGuest(guest);
      return;
    }

    showAlert('Закрыть чек', `Чек «${guest.label}» будет закрыт без оплаты. Продолжить?`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Закрыть',
        style: 'destructive',
        onPress: async () => {
          if (!(await ensureShiftOpen(guest.total))) return;
          await performCancel(guest);
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Не удалось открыть заказ'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  const selectedGuest: OrderGuest | undefined =
    order.guests.find((g) => g.id === selectedGuestId) ?? order.guests[0];
  const precheckLocked = Boolean(selectedGuest?.precheckPrintedAt);
  const precheckMode = Boolean(order.precheckEnabled);
  const moveTargetGuests = moveTarget
    ? order.guests.filter((g) => g.id !== moveTarget.currentGuestId)
    : [];

  return (
    <View style={styles.container}>
      <View style={[styles.menuPaneWrapper, precheckLocked && styles.menuPaneLocked]}>
        <MenuBrowser
          menu={menu}
          busy={busy || precheckLocked}
          onItemPress={handleMenuItemPress}
        />
        {precheckLocked ? (
          <View style={styles.lockBanner} pointerEvents="none">
            <Text style={styles.lockBannerText}>Пречек напечатан — состав зафиксирован</Text>
          </View>
        ) : null}
      </View>

      {/* Правая часть — гости и их чеки */}
      <View style={[styles.orderPane, { paddingBottom: 16 + insets.bottom }]}>
        <Text style={styles.orderTitle}>{tableName}</Text>
        {order.guests.length > 1 && (
          <Text style={styles.orderSubtotal}>Всего открыто по столу: {order.total.toFixed(2)} ₽</Text>
        )}
        {precheckLocked ? (
          <Text style={styles.precheckHint}>
            Пречек · {selectedGuest?.precheckPrintedByName || 'сотрудник'}
          </Text>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.guestTabs}
          contentContainerStyle={styles.guestTabsContent}
        >
          {order.guests.map((guest) => (
            <Pressable
              key={guest.id}
              style={[styles.guestTab, guest.id === selectedGuest?.id && styles.guestTabActive]}
              onPress={() => setSelectedGuestId(guest.id)}
            >
              <Text
                style={[
                  styles.guestTabLabel,
                  guest.id === selectedGuest?.id && styles.guestTabLabelActive,
                ]}
              >
                {guest.label}
              </Text>
              <Text
                style={[
                  styles.guestTabTotal,
                  guest.id === selectedGuest?.id && styles.guestTabLabelActive,
                ]}
              >
                {guest.total.toFixed(0)} ₽
              </Text>
            </Pressable>
          ))}
          <Pressable style={styles.addGuestButton} disabled={busy} onPress={handleAddGuest}>
            <Text style={styles.addGuestButtonText}>+ Гость</Text>
          </Pressable>
        </ScrollView>

        {!selectedGuest || selectedGuest.items.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Пока пусто — добавь позиции слева</Text>
          </View>
        ) : (
          <ScrollView style={styles.orderList}>
            {selectedGuest.items.map((item) => (
              <View key={item.id} style={styles.orderItemRow}>
                <View style={styles.orderItemInfo}>
                  <Text style={styles.orderItemName}>{item.name}</Text>
                  {(() => {
                    const summary = buildModifierSummary(item);
                    return summary ? (
                      <Text style={styles.modifierSummary} numberOfLines={2}>
                        {summary}
                      </Text>
                    ) : null;
                  })()}
                </View>
                <Text style={styles.orderItemPrice}>{item.lineTotal.toFixed(2)} ₽</Text>
                <View style={styles.qtyStepper}>
                  <Pressable
                    style={styles.qtyButton}
                    disabled={busy || precheckLocked}
                    hitSlop={6}
                    onPress={() => handleRemoveItem(item.id)}
                  >
                    <Text style={styles.qtyButtonText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyValue}>{item.qty}</Text>
                  <Pressable
                    style={styles.qtyButton}
                    disabled={busy || precheckLocked || !item.menuItemId}
                    hitSlop={6}
                    onPress={() => item.menuItemId && handleRepeatItem(item, selectedGuest.id)}
                  >
                    <Text style={styles.qtyButtonText}>+</Text>
                  </Pressable>
                </View>
                <Pressable
                  style={styles.iconButton}
                  disabled={busy || precheckLocked}
                  hitSlop={4}
                  onPress={() =>
                    setMoveTarget({ itemId: item.id, itemName: item.name, currentGuestId: selectedGuest.id })
                  }
                >
                  <Text style={styles.iconButtonText}>⋮</Text>
                </Pressable>
                <Pressable
                  style={styles.iconButton}
                  disabled={busy || precheckLocked}
                  hitSlop={4}
                  onPress={() => handleDeleteItemFully(item.id, item.name)}
                >
                  <Text style={styles.deleteItemButtonText}>🗑</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.totalRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.totalLabel}>Итого — {selectedGuest?.label ?? 'чек'}</Text>
            {selectedGuest && Number(selectedGuest.discountPercent) > 0 ? (
              <Text style={styles.discountInline}>
                скидка {selectedGuest.discountPercent}% · было{' '}
                {(selectedGuest.subtotal ?? selectedGuest.total).toFixed(2)} ₽
              </Text>
            ) : null}
          </View>
          <Text style={styles.totalValue}>{(selectedGuest?.total ?? 0).toFixed(2)} ₽</Text>
        </View>

        <View style={styles.actions}>
          {order.table && (
            <Pressable style={styles.transferButton} disabled={busy} onPress={openTransferModal}>
              <Text style={styles.transferButtonText}>🔀 Пересадить</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.actionButton, styles.discountButton]}
            disabled={
              busy ||
              !selectedGuest ||
              (selectedGuest.subtotal ?? selectedGuest.total) <= 0 ||
              precheckLocked
            }
            onPress={openDiscountModal}
          >
            <Text style={styles.discountButtonText}>
              Скидка
              {selectedGuest && Number(selectedGuest.discountPercent) > 0
                ? ` ${selectedGuest.discountPercent}%`
                : ''}
            </Text>
          </Pressable>
          {precheckMode && !precheckLocked ? (
            <Pressable
              style={[styles.actionButton, styles.precheckButton]}
              disabled={
                busy ||
                !selectedGuest ||
                (selectedGuest.subtotal ?? selectedGuest.total) <= 0
              }
              onPress={() => void handlePrecheck()}
            >
              <Text style={styles.precheckButtonText}>Пречек</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.payButtonWrapper}
            disabled={
              busy ||
              !selectedGuest ||
              (selectedGuest.subtotal ?? selectedGuest.total) <= 0 ||
              (precheckMode && !precheckLocked)
            }
            onPress={handlePay}
          >
            <LinearGradient
              colors={GRADIENT_BLUE}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.actionButton,
                (busy ||
                  !selectedGuest ||
                  (selectedGuest.subtotal ?? selectedGuest.total) <= 0 ||
                  (precheckMode && !precheckLocked)) &&
                  styles.actionButtonDisabled,
              ]}
            >
              <Text style={styles.payButtonText}>
                {precheckMode && !precheckLocked
                  ? 'Сначала пречек'
                  : `Оплата — ${selectedGuest?.label ?? ''}`}
              </Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.closeButton]}
            disabled={busy || !selectedGuest}
            onPress={handleClose}
          >
            <Text style={styles.closeButtonText}>
              {precheckLocked ? 'Отменить чек' : `Закрыть чек — ${selectedGuest?.label ?? ''}`}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Перенос позиции между гостями */}
      <Modal
        visible={moveTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMoveTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMoveTarget(null)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{moveTarget?.itemName}</Text>
            <Text style={styles.modalSubtitle}>Перенести к:</Text>

            {moveTargetGuests.length === 0 ? (
              <Text style={styles.modalEmptyText}>
                Сначала добавь ещё одного гостя, чтобы было куда переносить
              </Text>
            ) : (
              moveTargetGuests.map((g) => (
                <Pressable
                  key={g.id}
                  style={styles.modalOption}
                  onPress={() => handleConfirmMove(g.id)}
                >
                  <Text style={styles.modalOptionText}>{g.label}</Text>
                  <Text style={styles.modalOptionTotal}>{g.total.toFixed(0)} ₽</Text>
                </Pressable>
              ))
            )}

            <Pressable style={styles.modalCancel} onPress={() => setMoveTarget(null)}>
              <Text style={styles.modalCancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Пересадка на другой стол (в т.ч. другую зону) */}
      <Modal
        visible={transferOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTransferOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTransferOpen(false)}>
          <Pressable style={styles.transferModalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Пересадить на стол</Text>
            {transferLoading ? (
              <ActivityIndicator color={colors.accent2} style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {transferZones?.map((zone) => (
                  <View key={zone.id} style={styles.transferZoneBlock}>
                    <Text style={styles.transferZoneLabel}>{zone.name}</Text>
                    <View style={styles.tileGrid}>
                      {zone.tables.map((t) => {
                        const isCurrent = t.id === order.table?.id;
                        const isOccupied = t.status === 'occupied' && !isCurrent;
                        return (
                          <Pressable
                            key={t.id}
                            style={[
                              styles.transferTableTile,
                              isCurrent && styles.transferTableTileCurrent,
                              isOccupied && styles.transferTableTileDisabled,
                            ]}
                            disabled={isCurrent || isOccupied}
                            onPress={() => handleTransfer(t.id, t.name)}
                          >
                            <Text style={styles.transferTableName}>{t.name}</Text>
                            <Text style={styles.transferTableStatus}>
                              {isCurrent ? 'Текущий' : isOccupied ? 'Занят' : 'Свободен'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.modalCancel} onPress={() => setTransferOpen(false)}>
              <Text style={styles.modalCancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Выбор способа оплаты — крупные кнопки, ошибиться на реальной оплате
          гостя не должно быть просто */}
      <Modal
        visible={paymentTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => !paymentBusy && closePaymentModal()}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !paymentBusy && closePaymentModal()}>
          <Pressable style={styles.paymentModalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Оплата — {paymentTarget?.label}</Text>
            <Text style={styles.paymentAmount}>{payableAmount.toFixed(2)} ₽</Text>
            {paymentDiscountPct > 0 ? (
              <Text style={styles.discountHint}>
                было {paymentSubtotal.toFixed(2)} ₽ · скидка {paymentDiscountPct}% (−
                {paymentDiscountAmount.toFixed(2)} ₽)
              </Text>
            ) : null}

            {paymentBusy ? (
              <ActivityIndicator color={colors.accent2} style={{ marginVertical: 24 }} />
            ) : cashEntryMode ? (
              <>
                <Text style={styles.modalSubtitle}>Сколько дал гость?</Text>
                <View style={styles.cashDisplay}>
                  <Text style={styles.cashDisplayText}>{cashReceivedText || '0'} ₽</Text>
                </View>
                <View style={styles.cashKeypad}>
                  {CASH_KEY_ROWS.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.cashKeypadRow}>
                      {row.map((key) => (
                        <Pressable
                          key={key}
                          style={({ pressed }) => [styles.cashKey, pressed && styles.cashKeyPressed]}
                          onPress={() => handleCashKeyPress(key)}
                        >
                          <Text style={styles.cashKeyText}>{key}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
                <View style={styles.changeRow}>
                  <Text style={styles.changeLabel}>Сдача</Text>
                  <Text
                    style={[styles.changeValue, changeAmount < 0 && styles.changeValueNegative]}
                  >
                    {changeAmount.toFixed(2)} ₽
                  </Text>
                </View>
                <Pressable
                  style={[styles.confirmCashButton, !canConfirmCash && styles.actionButtonDisabled]}
                  disabled={!canConfirmCash}
                  onPress={() => confirmPayment('cash')}
                >
                  <Text style={styles.paymentMethodLabel}>Подтвердить</Text>
                </Pressable>
                <Pressable style={styles.modalCancel} onPress={() => setCashEntryMode(false)}>
                  <Text style={styles.modalCancelText}>← Назад к способу оплаты</Text>
                </Pressable>
              </>
            ) : paymentDiscountPct === 100 ? (
              <>
                <Text style={styles.modalSubtitle}>Чек будет закрыт как комплимент (0 ₽)</Text>
                <Pressable
                  style={[styles.paymentMethodButton, styles.paymentMethodComp]}
                  onPress={confirmComplimentary}
                >
                  <Text style={styles.paymentMethodLabel}>Закрыть со скидкой 100%</Text>
                </Pressable>
                <Pressable style={styles.modalCancel} onPress={closePaymentModal}>
                  <Text style={styles.modalCancelText}>Отмена</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalSubtitle}>Выбери способ оплаты</Text>
                <Pressable
                  style={[styles.paymentMethodButton, styles.paymentMethodCash]}
                  onPress={() => setCashEntryMode(true)}
                >
                  <Text style={styles.paymentMethodIcon}>💵</Text>
                  <Text style={styles.paymentMethodLabel}>Наличные</Text>
                </Pressable>
                <Pressable
                  style={[styles.paymentMethodButton, styles.paymentMethodCard]}
                  onPress={() => confirmPayment('card')}
                >
                  <Text style={styles.paymentMethodIcon}>💳</Text>
                  <Text style={styles.paymentMethodLabel}>Безналичный</Text>
                </Pressable>
                <Pressable style={styles.modalCancel} onPress={closePaymentModal}>
                  <Text style={styles.modalCancelText}>Отмена</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Скидка на выбранного гостя — до пречека, не на весь стол */}
      <Modal
        visible={discountGuest !== null}
        transparent
        animationType="fade"
        onRequestClose={() => !discountBusy && setDiscountGuest(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !discountBusy && setDiscountGuest(null)}
        >
          <Pressable style={styles.paymentModalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Скидка — {discountGuest?.label}</Text>
            {(() => {
              const sub = discountGuest
                ? roundMoney(discountGuest.subtotal ?? discountGuest.total)
                : 0;
              const payable = roundMoney(sub * (1 - discountDraft / 100));
              return (
                <>
                  <Text style={styles.paymentAmount}>{payable.toFixed(2)} ₽</Text>
                  <Text style={styles.discountHint}>
                    сумма гостя {sub.toFixed(2)} ₽
                    {discountDraft > 0 ? ` · −${discountDraft}%` : ' · без скидки'}
                  </Text>
                </>
              );
            })()}
            {discountBusy ? (
              <ActivityIndicator color={colors.accent2} style={{ marginVertical: 24 }} />
            ) : (
              <>
                <Text style={styles.modalSubtitle}>Процент для этого гостя</Text>
                <View style={styles.discountRow}>
                  {DISCOUNT_OPTIONS.map((pct) => (
                    <Pressable
                      key={pct}
                      style={[
                        styles.discountChip,
                        discountDraft === pct && styles.discountChipActive,
                      ]}
                      onPress={() => setDiscountDraft(pct)}
                    >
                      <Text
                        style={[
                          styles.discountChipText,
                          discountDraft === pct && styles.discountChipTextActive,
                        ]}
                      >
                        {pct === 0 ? '0%' : `${pct}%`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={[styles.confirmCashButton, { marginTop: 16 }]}
                  onPress={() => void confirmGuestDiscount()}
                >
                  <Text style={styles.paymentMethodLabel}>Сохранить</Text>
                </Pressable>
                <Pressable style={styles.modalCancel} onPress={() => setDiscountGuest(null)}>
                  <Text style={styles.modalCancelText}>Отмена</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Полный состав позиции — отдельным окном, а не встроенным текстом:
          при 6-7 ингредиентах инлайн не помещается и выглядит громоздко */}
      <CompositionModal target={compositionTarget} onClose={() => setCompositionTarget(null)} />

      {/* Настройка состава при добавлении позиции — снять дефолтные ингредиенты,
          докупить платные модификаторы, до того, как позиция попадёт в чек */}
      <ItemCustomizeModal
        item={customizeTarget}
        onClose={() => setCustomizeTarget(null)}
        onConfirm={handleConfirmCustomize}
      />

      {/* Общий алерт — свой, в теме приложения, вместо системного Alert.alert */}
      <Modal
        visible={alertState !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertState(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAlertState(null)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{alertState?.title}</Text>
            <Text style={styles.modalSubtitle}>{alertState?.message}</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              {alertState?.buttons.map((b, i) => (
                <Pressable
                  key={i}
                  style={[
                    styles.alertButton,
                    b.style === 'destructive' && styles.alertButtonDestructive,
                    b.style === 'cancel' && styles.alertButtonCancel,
                  ]}
                  onPress={() => {
                    setAlertState(null);
                    b.onPress?.();
                  }}
                >
                  <Text
                    style={[
                      styles.alertButtonText,
                      b.style === 'destructive' && styles.alertButtonTextDestructive,
                      b.style === 'cancel' && styles.alertButtonTextCancel,
                    ]}
                  >
                    {b.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <CommentPromptModal
        visible={cancelCommentGuest !== null}
        title="Отмена после пречека"
        subtitle={`Чек «${cancelCommentGuest?.label ?? ''}» будет отменён. Укажите причину — она сохранится в бэкофисе.`}
        placeholder="Причина отмены"
        confirmLabel="Отменить чек"
        onCancel={() => setCancelCommentGuest(null)}
        onConfirm={(comment) => {
          if (cancelCommentGuest) void performCancel(cancelCommentGuest, comment);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  menuPaneLocked: { opacity: 0.55 },
  lockBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  lockBannerText: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  precheckHint: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
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

  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  menuPaneWrapper: {
    flex: 1.3,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    position: 'relative',
  },

  orderPane: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  orderTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  orderSubtotal: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
  },

  guestTabs: { flexGrow: 0, marginBottom: 8 },
  guestTabsContent: { gap: 8, paddingBottom: 4 },
  guestTab: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 84,
  },
  guestTabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  guestTabLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  guestTabTotal: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  guestTabLabelActive: { color: '#f1f1f3' },
  addGuestButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGuestButtonText: { color: colors.textMuted, fontSize: 13 },

  orderList: { flex: 1 },
  orderItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  orderItemInfo: { flex: 1 },
  orderItemName: { color: colors.text, fontSize: 14, fontWeight: '500' },
  compositionLink: { color: colors.accent2, fontSize: 11, marginTop: 2, fontWeight: '600' },
  modifierSummary: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  orderItemPrice: { color: colors.text, fontSize: 14, fontWeight: '600' },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
  },
  qtyButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: ICON_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 24 },
  qtyValue: { color: colors.text, fontSize: 15, fontWeight: '600', minWidth: 22, textAlign: 'center' },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: ICON_BUTTON_SIZE / 2,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonText: { color: colors.textMuted, fontSize: 22, lineHeight: 22, fontWeight: '700' },
  deleteItemButtonText: { fontSize: 20 },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
  },
  totalLabel: { color: colors.textMuted, fontSize: 15 },
  totalValue: { color: colors.text, fontSize: 22, fontWeight: '700' },

  actions: { gap: 12 },
  payButtonWrapper: { width: '100%' },
  transferButton: {
    borderRadius: 12,
    minHeight: 54,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  transferButtonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  actionButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: { opacity: 0.5 },
  payButtonText: { color: '#f1f1f3', fontSize: 17, fontWeight: '700' },
  closeButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  precheckButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent2,
  },
  precheckButtonText: { color: colors.accent2, fontSize: 16, fontWeight: '700' },
  discountButton: {
    backgroundColor: 'rgba(230, 160, 63, 0.1)',
    borderWidth: 1,
    borderColor: '#e6a03f',
  },
  discountButtonText: { color: '#e6a03f', fontSize: 16, fontWeight: '700' },
  discountInline: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

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
  transferModalBox: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: colors.textMuted, fontSize: 13, marginBottom: 14 },
  modalEmptyText: { color: colors.textMuted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  modalOptionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  modalOptionTotal: { color: colors.textMuted, fontSize: 13 },
  modalCancel: {
    marginTop: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontSize: 14 },

  transferZoneBlock: { marginBottom: 16 },
  transferZoneLabel: { color: colors.accent2, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  transferTableTile: {
    width: '31%',
    minHeight: 64,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  transferTableTileCurrent: { borderColor: colors.accent2, opacity: 0.6 },
  transferTableTileDisabled: { opacity: 0.4 },
  transferTableName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  transferTableStatus: { color: colors.textMuted, fontSize: 11 },

  alertButton: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  alertButtonDestructive: { borderColor: colors.danger },
  alertButtonCancel: { backgroundColor: 'transparent', borderColor: 'transparent' },
  alertButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  alertButtonTextDestructive: { color: colors.danger },
  alertButtonTextCancel: { color: colors.textMuted, fontWeight: '400' },

  paymentModalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  paymentAmount: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 4,
    marginBottom: 4,
  },
  discountHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  discountRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  discountChip: {
    minWidth: 56,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: 'center',
  },
  discountChipActive: {
    borderColor: colors.accent2,
    backgroundColor: 'rgba(63, 99, 230, 0.18)',
  },
  discountChipText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  discountChipTextActive: {
    color: colors.text,
  },
  paymentMethodButton: {
    width: '100%',
    minHeight: 96,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    borderWidth: 2,
    gap: 8,
  },
  paymentMethodCash: {
    backgroundColor: 'rgba(63, 173, 99, 0.12)',
    borderColor: '#3fad63',
  },
  paymentMethodCard: {
    backgroundColor: 'rgba(63, 99, 230, 0.12)',
    borderColor: colors.accent2,
  },
  paymentMethodComp: {
    backgroundColor: 'rgba(230, 160, 63, 0.14)',
    borderColor: '#e6a03f',
    minHeight: 72,
  },
  paymentMethodIcon: { fontSize: 40, lineHeight: 44 },
  paymentMethodLabel: { color: colors.text, fontSize: 20, fontWeight: '700' },

  cashDisplay: {
    width: '100%',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  cashDisplayText: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  cashKeypad: {
    width: '100%',
    marginTop: 12,
    alignItems: 'center',
  },
  cashKeypadRow: {
    flexDirection: 'row',
  },
  cashKey: {
    width: 72,
    height: 56,
    margin: 4,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashKeyPressed: {
    backgroundColor: colors.surface2,
    borderColor: colors.accent2,
  },
  cashKeyText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '500',
  },
  changeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  changeLabel: { color: colors.textMuted, fontSize: 15 },
  changeValue: { color: '#3fad63', fontSize: 22, fontWeight: '800' },
  changeValueNegative: { color: colors.danger },
  confirmCashButton: {
    width: '100%',
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
});