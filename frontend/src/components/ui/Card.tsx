/**
 * Card — a translucent surface "lift" over the dark background, per the
 * styling guide's elevation system. Use `accent` to add the red left bar
 * that marks banner-style cards.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme';

interface CardProps {
  children: React.ReactNode;
  /** Adds the 3px red left border used by highlight banners. */
  accent?: boolean;
  /** deep = the brighter tier-3 surface for nested/raised cards. */
  tier?: 'surface' | 'deep';
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, accent = false, tier = 'surface', style }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        tier === 'deep' && styles.deep,
        accent && styles.accent,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  deep: {
    backgroundColor: colors.surfaceDeep,
  },
  accent: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
});
