/**
 * LetterAvatar — the round red badge with a person's first letter, shown beside their name when
 * they have no profile photo (the `Avatar` component falls back to it). Decorative only: the name
 * next to it is what screen readers announce. `size` is its diameter in points (36 on cards, 72
 * at the top of a profile).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Body } from '@/components/ui/Text';
import { colors, radii, type } from '@/theme';

/** Above this diameter (points) the letter is drawn big — the profile header's badge, not a card's. */
const LARGE_FROM = 48;

export function LetterAvatar({ initial, size = 36 }: { initial: string; size?: number }) {
  return (
    <View
      style={[styles.avatar, { width: size, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      testID="letter-avatar"
    >
      <Body style={[styles.initial, size > LARGE_FROM && styles.initialLarge]}>{initial}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
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
  initialLarge: {
    fontSize: 28,
    lineHeight: 34,
  },
});
