import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { useCurrentShift } from '../hooks/useCurrentShift';
import { openShift, closeShift } from '../api/client';
import { runPendingFiscalJobs } from '../services/fiscalWorker';

const KNOB_SIZE = 52;
const TRACK_HEIGHT = 60;
// Долю пути, которую нужно протащить, чтобы действие засчиталось — само по
// себе прохождение почти всего трека и есть подтверждение (как slide-to-unlock),
// отдельное диалоговое окно поэтому не нужно: случайным тапом это не сработает.
const COMPLETE_RATIO = 0.82;

function formatTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function ShiftToggle() {
  const { session, venue, shift, setShift, loading, error, reload } = useCurrentShift();
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const isOpen = Boolean(shift);
  const maxTravel = Math.max(0, trackWidth - KNOB_SIZE);

  const pan = useRef(new Animated.Value(0)).current;
  const knobHalfWidth = useRef(new Animated.Value(KNOB_SIZE / 2)).current;
  const dragStartValue = useRef(0);
  const initializedRef = useRef(false);

  // PanResponder создаётся один раз (useRef) и не пересоздаётся при каждом
  // рендере — а значит его обработчики иначе "запомнили" бы toggling/maxTravel/
  // isOpen из САМОГО ПЕРВОГО рендера (когда трек ещё не измерен, maxTravel = 0)
  // и никогда не реагировали бы на реальные изменения. liveRef обновляется
  // синхронно на каждом рендере — обработчики читают его в момент жеста,
  // а не в момент создания.
  const liveRef = useRef({ isOpen, maxTravel, toggling, session, venue });
  liveRef.current = { isOpen, maxTravel, toggling, session, venue };

  // Первичная установка положения ползунка, когда уже известна и ширина
  // трека, и текущий статус смены — без анимации, это не пользовательское
  // действие, а просто отображение начального состояния.
  useEffect(() => {
    if (initializedRef.current || loading || maxTravel <= 0) return;
    pan.setValue(isOpen ? maxTravel : 0);
    initializedRef.current = true;
  }, [loading, maxTravel, isOpen, pan]);

  const snapTo = (value: number) => {
    Animated.spring(pan, {
      toValue: value,
      useNativeDriver: false,
      bounciness: 6,
      speed: 14,
    }).start();
  };

  const handleOpen = async () => {
    const { session: liveSession, venue: liveVenue } = liveRef.current;
    if (!liveSession || !liveVenue) return;
    setActionError(null);
    setToggling(true);
    try {
      const opened = await openShift(liveVenue.id, liveSession.token);
      setShift(opened);
      // Не ждём фискализацию — она не должна задерживать открытие смены на
      // экране, при сбое задание останется в очереди и разберётся фоном.
      runPendingFiscalJobs(liveVenue.id, liveSession.token);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Не удалось открыть смену');
      snapTo(0);
    } finally {
      setToggling(false);
    }
  };

  const handleClose = async () => {
    const { session: liveSession, venue: liveVenue, maxTravel: liveMaxTravel } = liveRef.current;
    if (!liveSession || !liveVenue) return;
    setActionError(null);
    setToggling(true);
    try {
      await closeShift(liveVenue.id, liveSession.token);
      setShift(null);
      runPendingFiscalJobs(liveVenue.id, liveSession.token);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Не удалось закрыть смену');
      snapTo(liveMaxTravel);
    } finally {
      setToggling(false);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !liveRef.current.toggling && liveRef.current.maxTravel > 0,
        onMoveShouldSetPanResponder: () => !liveRef.current.toggling && liveRef.current.maxTravel > 0,
        onPanResponderGrant: () => {
          dragStartValue.current = liveRef.current.isOpen ? liveRef.current.maxTravel : 0;
        },
        onPanResponderMove: (_evt, gestureState) => {
          const mt = liveRef.current.maxTravel;
          const next = Math.max(0, Math.min(mt, dragStartValue.current + gestureState.dx));
          pan.setValue(next);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const mt = liveRef.current.maxTravel;
          const openNow = liveRef.current.isOpen;
          const raw = dragStartValue.current + gestureState.dx;
          const clamped = Math.max(0, Math.min(mt, raw));
          const progress = mt > 0 ? clamped / mt : 0;

          if (!openNow && progress >= COMPLETE_RATIO) {
            snapTo(mt);
            handleOpen();
          } else if (openNow && progress <= 1 - COMPLETE_RATIO) {
            snapTo(0);
            handleClose();
          } else {
            snapTo(openNow ? mt : 0);
          }
        },
      }),
    // Создаём один раз (пустые deps) — все нужные данные обработчики берут
    // из liveRef.current в момент жеста, а не из замыкания при создании.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const fillWidth = Animated.add(pan, knobHalfWidth);
  const hintOpacity = pan.interpolate({
    inputRange: [0, maxTravel || 1],
    outputRange: isOpen ? [0, 1] : [1, 0],
  });

  if (loading) {
    return (
      <View style={[styles.card, styles.center]}>
        <ActivityIndicator color={colors.accent2} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.retryLink} onPress={reload}>
          Повторить
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.statusTitle}>Смена {isOpen ? 'открыта' : 'закрыта'}</Text>
      <Text style={styles.statusSubtitle}>
        {isOpen
          ? `с ${formatTime(shift?.openedAt ?? null)}${shift?.openedByName ? ` · ${shift.openedByName}` : ''}`
          : 'Протащите ползунок вправо, чтобы начать смену'}
      </Text>

      {/*
        Трек и бегунок — НЕ вложены друг в друга: трек со скруглением и
        overflow:hidden обрезает всё, что внутри него (в т.ч. тень бегунка на
        iOS и слой elevation на Android — из-за этого бегунок визуально
        "проваливался" под трек). Поэтому бегунок — отдельный слой поверх
        wrapper'а, а не ребёнок обрезаемого трека.
      */}
      <View style={styles.trackWrapper} onLayout={handleTrackLayout}>
        <View style={[styles.track, isOpen ? styles.trackOpen : styles.trackClosed]}>
          <Animated.View
            style={[styles.trackFill, { width: fillWidth }, isOpen ? styles.fillOpen : styles.fillClosed]}
          />

          <Animated.Text style={[styles.trackHint, { opacity: hintOpacity }]} numberOfLines={1}>
            {isOpen ? '‹‹ потяните, чтобы закрыть' : 'потяните, чтобы открыть ››'}
          </Animated.Text>
        </View>

        {trackWidth > 0 && (
          <Animated.View
            style={[
              styles.knob,
              isOpen ? styles.knobOpen : styles.knobClosed,
              { transform: [{ translateX: pan }] },
            ]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            {...panResponder.panHandlers}
          >
            {toggling ? (
              <ActivityIndicator color={colors.accent2} size="small" />
            ) : (
              <View style={[styles.knobDot, isOpen ? styles.knobDotOpen : styles.knobDotClosed]} />
            )}
          </Animated.View>
        )}
      </View>

      {actionError && (
        <Text style={styles.actionErrorText} onPress={() => setActionError(null)}>
          {actionError} · скрыть
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 96 },
  statusTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  statusSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: 14 },
  trackWrapper: {
    height: TRACK_HEIGHT,
    position: 'relative',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  trackClosed: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
  },
  trackOpen: {
    backgroundColor: colors.surface2,
    borderColor: colors.accent2,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
    zIndex: 0,
  },
  fillClosed: { backgroundColor: 'rgba(63, 99, 230, 0.16)' },
  fillOpen: { backgroundColor: 'rgba(63, 99, 230, 0.35)' },
  trackHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    zIndex: 1,
  },
  knob: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
    zIndex: 2,
  },
  knobClosed: { borderColor: colors.border },
  knobOpen: { borderColor: colors.accent2 },
  knobDot: { width: 14, height: 14, borderRadius: 7 },
  knobDotClosed: { backgroundColor: colors.textMuted },
  knobDotOpen: { backgroundColor: colors.accent2 },
  errorText: { color: colors.danger, fontSize: 13 },
  retryLink: { color: colors.accent2, fontSize: 13, fontWeight: '600', marginTop: 8 },
  actionErrorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
});
