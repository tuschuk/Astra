/**
 * Exercise history — every past session of one exercise, and the lifter's records on it (LOG-4).
 *
 * What it shows: Back, then the shared `ExerciseHistorySection` with the exercise's name as its
 * heading — a "Current PRs" card, then one card per finished workout that included the exercise,
 * newest first, with that exercise's sets (see the section for the exact layout). The Library's
 * exercise card draws the very same section, so the two screens can never show different numbers.
 *
 * Reached from the "History" link in the logger's last-time panel and the workout edit screen,
 * by the exercise's database id — so it also works for exercises with no Library card. Reads only
 * the phone's database, so it works with no signal. What the lifter can do: read it, reveal older
 * sessions batch by batch, and go Back.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExerciseHistorySection } from '@/components/workout/ExerciseHistorySection';
import { spacing } from '@/theme';

export default function ExerciseHistoryScreen() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();

  /** Back to the logger (or wherever this was opened from), or the Workout tab. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      {typeof exerciseId === 'string' ? (
        <ExerciseHistorySection exerciseId={exerciseId} showName />
      ) : (
        <EmptyState icon="barbell-outline" message="This exercise’s history couldn’t be read." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
});
