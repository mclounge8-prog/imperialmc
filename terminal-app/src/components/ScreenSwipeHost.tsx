import React, { useMemo, useRef } from 'react';
import { Dimensions, PanResponder, StyleSheet, View, type ViewProps } from 'react-native';
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

const EDGE_PX = 56;
const MIN_DX = 64;
const MIN_VX = 0.35;

/**
 * Оборачивает экран и ловит горизонтальные свайпы для перехода
 * Tables ↔ Состав ↔ Настройки.
 *
 * Жест берётся:
 * - от левого/правого края (не мешает скроллам в центре),
 * - либо уверенный горизонтальный свайп по центру (dx и скорость).
 */
export default function ScreenSwipeHost({ screen, children, style, ...rest }: Props) {
  const navigation = useNavigation<NavigationProp>();
  const index = MAIN_HUB_SCREENS.indexOf(screen);

  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const indexRef = useRef(index);
  indexRef.current = index;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (evt, gesture) => {
          const absDx = Math.abs(gesture.dx);
          const absDy = Math.abs(gesture.dy);
          if (absDx < 14 || absDx < absDy * 1.4) return false;

          const startX = evt.nativeEvent.pageX - gesture.dx;
          const width = Dimensions.get('window').width;
          const fromLeft = startX <= EDGE_PX;
          const fromRight = startX >= width - EDGE_PX;

          if (fromLeft && gesture.dx > 0) return true;
          if (fromRight && gesture.dx < 0) return true;

          // Центр экрана — только «уверенный» жест, чтобы не воевать со ScrollView
          return absDx > 48 && absDx > absDy * 2.2;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, gesture) => {
          const idx = indexRef.current;
          const goLeft = gesture.dx < -MIN_DX || gesture.vx < -MIN_VX;
          const goRight = gesture.dx > MIN_DX || gesture.vx > MIN_VX;

          if (goLeft && idx < MAIN_HUB_SCREENS.length - 1) {
            navigationRef.current.navigate(MAIN_HUB_SCREENS[idx + 1]);
            return;
          }
          if (goRight && idx > 0) {
            navigationRef.current.navigate(MAIN_HUB_SCREENS[idx - 1]);
          }
        },
      }),
    []
  );

  return (
    <View style={[styles.root, style]} {...rest} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
