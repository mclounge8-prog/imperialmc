import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

/** Основные экраны хаба (навигация — только кнопками в шапке, без свайпов). */
export const MAIN_HUB_SCREENS = ['Tables', 'MenuReference', 'Settings'] as const;
export type MainHubScreen = (typeof MAIN_HUB_SCREENS)[number];

type Props = ViewProps & {
  screen: MainHubScreen;
  children: React.ReactNode;
};

/**
 * Раньше ловил горизонтальные свайпы Tables ↔ Состав ↔ Настройки.
 * Отключено: жест конфликтовал со слайдером открытия смены и уводил на
 * соседний экран. Переходы — через иконки в headerRight.
 */
export default function ScreenSwipeHost({ screen: _screen, children, style, ...rest }: Props) {
  return (
    <View style={[styles.root, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
