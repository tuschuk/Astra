/**
 * CustomPill — the small red-tinted "Custom" label that marks one of the lifter's own exercises
 * (LIB-5, B31), on its Library card and on its own card screen, so a custom is never mistaken for
 * a founder-authored library exercise. Display only; nothing to tap.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionLabel } from '@/components/ui/Text';
import { colors, radii, spacing } from '@/theme';

/** Draws the pill. */
export function CustomPill() {
  return (
    <View style={styles.pill}>
      <SectionLabel size="small" style={styles.text}>
        Custom
      </SectionLabel>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
    borderRadius: radii.md,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  text: {
    color: colors.text,
  },
});
