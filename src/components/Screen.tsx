/**
 * Screen — the standard wrapper every tab screen renders inside.
 *
 * Provides, in order: the dark page background with Astra's gradient-and-grid
 * texture, safe-area padding at the top, horizontal screen padding, and
 * (by default) vertical scrolling. Screens compose their content inside it
 * and never set their own background.
 */
import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '@/theme';

import { AppBackground } from './AppBackground';

interface ScreenProps {
  children: React.ReactNode;
  /** Set false for screens that manage their own scrolling (lists). */
  scroll?: boolean;
  /** Extra styling for the content container. */
  contentStyle?: ViewStyle;
}

export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + spacing.lg,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
  };

  return (
    <View style={styles.root}>
      <AppBackground />
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[padding, contentStyle]}
          showsVerticalScrollIndicator={false}
          // With the keyboard open, a tap on a button/chip should press it,
          // not just dismiss the keyboard (default 'never' swallows the tap).
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Solid base behind the gradient so nothing flashes white during mount.
    backgroundColor: colors.bg,
  },
  fill: {
    flex: 1,
  },
});
