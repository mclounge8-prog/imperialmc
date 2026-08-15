import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, type ViewProps } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';

/** Основные экраны хаба — между ними листаем горизонтальным свайпом. */
export const MAIN_HUB_SCREENS = ['Tables', 'MenuReference', 'Settings'] as const;
export type MainHubScreen = (typeof MAIN_HUB_SCREENS)[number];

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type Props = ViewProps & {
  screen: MainHubScreen;
  children: React.ReactNode;
};

/** Невидимые полосы по краям — жест не отбирают ScrollView в центре. */
const EDGE_WIDTH = 72;
const MIN_DX = 56;
const MIN_VX = 0.3;

/**
 * Переходы Tables ↔ Состав ↔ Настройки:
 * 1) свайп по левому/правому краю (поверх контента — надёжно),
 * 2) уверенный горизонтальный свайп по всему экрану (capture, если dx >> dy).
 */
export default function ScreenSwipeHost({ screen, children, style, ...rest }: Props) {
  const navigation = useNavigation<NavigationProp>();
  const index = MAIN_HUB_SCREENS.indexOf(screen);

  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const indexRef = useRef(index);
  indexRef.current = index;

  const goNext = () => {
    const idx = indexRef.current;
    if (idx >= 0 && idx < MAIN_HUB_SCREENS.length - 1) {
      navigationRef.current.navigate(MAIN_HUB_SCREENS[idx + 1]);
    }
  };

  const goPrev = () => {
    const idx = indexRef.current;
    if (idx > 0) {
      navigationRef.current.navigate(MAIN_HUB_SCREENS[idx - 1]);
    }
  };

  const applySwipe = (dx: number, vx: number) => {
    if (dx < -MIN_DX || vx < -MIN_VX) {
      goNext();
      return;
    }
    if (dx > MIN_DX || vx > MIN_VX) {
      goPrev();
    }
  };

  const leftEdgePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (g.dx > MIN_DX || g.vx > MIN_VX) goPrev();
        },
      }),
    []
  );

  const rightEdgePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -MIN_DX || g.vx < -MIN_VX) goNext();
        },
      }),
    []
  );

  // Захват уверенного горизонтального жеста до ScrollView-детей
  const pagePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) => {
          const absDx = Math.abs(g.dx);
          const absDy = Math.abs(g.dy);
          return absDx > 28 && absDx > absDy * 2.5;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => applySwipe(g.dx, g.vx),
        onPanResponderTerminate: (_e, g) => applySwipe(g.dx, g.vx),
      }),
    []
  );

  const canGoPrev = index > 0;
  const canGoNext = index >= 0 && index < MAIN_HUB_SCREENS.length - 1;

  return (
    <View style={[styles.root, style]} {...rest} {...pagePan.panHandlers}>
      {children}
      {canGoPrev ? (
        <View style={styles.leftEdge} collapsable={false} {...leftEdgePan.panHandlers} />
      ) : null}
      {canGoNext ? (
        <View style={styles.rightEdge} collapsable={false} {...rightEdgePan.panHandlers} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  leftEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
    zIndex: 50,
    elevation: 50,
  },
  rightEdge: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
    zIndex: 50,
    elevation: 50,
  },
});
