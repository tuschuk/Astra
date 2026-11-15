/**
 * WorkoutListItem — one finished workout in the Workout tab's history list.
 *
 * What it shows: the workout's date (its name until titles arrive with B12), how long it took,
 * and how many exercises and sets it had — "Sat, Nov 14, 2026 · 58 min · 3 exercises · 12 sets".
 *
 * What the lifter can do: tap it to open the saved workout with every set.
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Body } from '@/components/ui/Text';
import { workoutDateLabel, workoutDetailsLabel } from '@/workout/format';
import type { PastWorkoutSummary } from '@/workout/history';
import { colors, layout, radii, spacing } from '@/theme';

interface WorkoutListItemProps {
  summary: PastWorkoutSummary;
  onPress: () => void;
}

export function WorkoutListItem({ summary, onPress }: WorkoutListItemProps) {
  const { workout, exerciseCount, setCount } = summary;
  const title = workout.title ?? workoutDateLabel(workout.started_at);
  const details = workoutDetailsLabel(workout, exerciseCount, setCount);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open workout from ${title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <Body style={styles.title}>{title}</Body>
      <Body variant="small">{details}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    minHeight: layout.minTouchTarget,
    gap: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  title: {
    color: colors.text,
  },
});
