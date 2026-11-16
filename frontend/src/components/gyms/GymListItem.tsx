/**
 * GymListItem — one gym as a row (B50): used by the gym directory, Communities' "Your gym" and
 * the profile's Gym section.
 *
 * What it shows: the gym's name, and under it its address — plus, in the directory, how far
 * away it is ("2.3 mi").
 *
 * What the user can do: tap the row to open the gym's page (its members and Gym feed).
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Body } from '@/components/ui/Text';
import type { Gym } from '@/social/gyms';
import { colors, radii, spacing } from '@/theme';

interface GymListItemProps {
  gym: Gym;
  /** Extra detail after the address — the directory's distance ("2.3 mi"); absent shows none. */
  detail?: string | null;
  onPress: () => void;
}

export function GymListItem({ gym, detail = null, onPress }: GymListItemProps) {
  const details = [gym.address, detail].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open gym ${gym.name}${detail ? `, ${detail}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Body style={styles.name}>{gym.name}</Body>
      <Body variant="small">{details}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  pressed: {
    opacity: 0.7,
  },
  name: {
    color: colors.text,
  },
});
