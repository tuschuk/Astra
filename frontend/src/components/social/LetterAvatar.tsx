/**
 * LetterAvatar — the round red badge with a person's first letter, shown beside their name on
 * post cards and user cards until profile photos exist (B25). Decorative only: the name next to
 * it is what screen readers announce.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Body } from '@/components/ui/Text';
import { colors, radii, type } from '@/theme';

export function LetterAvatar({ initial }: { initial: string }) {
  return (
    <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
      <Body style={styles.initial}>{initial}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radii.round,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    ...type.button,
  },
});
