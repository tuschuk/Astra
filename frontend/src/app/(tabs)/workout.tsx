/**
 * Workout — the logger's front door (LOG-1) and the app's boldest screen.
 *
 * What it shows:
 *   - with no workout in progress: **Start empty workout** (starts a blank workout and opens the
 *     logger) and **Start from a program** (disabled until programs arrive, B35);
 *   - with a workout in progress on this phone (even one left behind when the app was killed):
 *     **Resume workout** and **Discard** instead — never a second workout on top of the first;
 *   - a preview of the Tool Kit (TK-1..TK-5; the tiles are still placeholders);
 *   - the lifter's finished workouts, newest first (the latest 100), each opening the saved
 *     workout with every set.
 *
 * Every time the tab comes into view it re-checks the phone's database, so the list and the
 * Resume button are always current (after finishing a workout, after a relaunch…). Everything
 * shown comes from the phone, so it works with no signal.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { WorkoutListItem } from '@/components/workout/WorkoutListItem';
import { confirmDiscardWorkout } from '@/components/workout/confirmDiscardWorkout';
import { useAppDatabase } from '@/db/useAppDatabase';
import { clearSessionWorkout, resumeSessionWorkout, startSessionWorkout } from '@/workout/activeWorkoutSession';
import { listPastWorkouts, type PastWorkoutSummary } from '@/workout/history';
import { useSessionWorkout } from '@/workout/useActiveWorkout';
import { colors, fonts, spacing } from '@/theme';

/** The five Tool Kit utilities, in the order they'll ship (TK-1..TK-5). */
const TOOL_KIT = ['1RM', 'RPE', '%1RM', 'Plates', 'Timer'] as const;

export default function WorkoutScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const active = useSessionWorkout(userId);
  const [past, setPast] = useState<PastWorkoutSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-reads the workout in progress (into the session slot) and the history list. */
  const refresh = useCallback(async () => {
    if (!db || !userId) return;
    try {
      await resumeSessionWorkout(db, userId);
      setPast(await listPastWorkouts(db, userId));
      setError(null);
    } catch (caught) {
      console.warn('Workout tab: could not read workouts from the phone', caught);
      setError('Your workouts couldn’t be read from this phone.');
    } finally {
      setLoaded(true);
    }
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /** Starts a blank workout and opens the logger (LOG-1). */
  async function start(): Promise<void> {
    if (!db || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startSessionWorkout(db, userId);
      router.push('/active-workout');
    } catch (caught) {
      // Most likely a workout already in progress (started on another screen a moment ago):
      // re-read, so the tab now offers Resume.
      console.warn('Workout tab: could not start a workout', caught);
      setError('A workout couldn’t be started. If one is in progress, resume it.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Asks first, then deletes the workout in progress from the phone. */
  function confirmDiscard(): void {
    if (!active) return;
    confirmDiscardWorkout(() => {
      void (async () => {
        setBusy(true);
        try {
          await active.discard();
          clearSessionWorkout();
        } catch (caught) {
          console.warn('Workout tab: could not discard', caught);
          setError('The workout couldn’t be discarded. Try again.');
        } finally {
          setBusy(false);
        }
      })();
    });
  }

  const ready = db != null && userId != null && loaded;

  const header = (
    <View>
      <Heading size="display">Workout</Heading>
      <Body variant="muted" style={styles.lede}>
        Log every set, catch every PR.
      </Body>

      <View style={styles.actions}>
        {active ? (
          <>
            <Button label="Resume workout" onPress={() => router.push('/active-workout')} disabled={busy} />
            <Button label="Discard workout" onPress={confirmDiscard} variant="ghost" disabled={busy} />
          </>
        ) : (
          <>
            <Button label="Start empty workout" onPress={() => void start()} disabled={!ready || busy} />
            {/* Programs arrive with B35. */}
            <Button label="Start from a program" onPress={() => {}} variant="ghost" disabled />
          </>
        )}
        <FormError message={dbError ? 'This phone’s workout storage couldn’t be opened.' : error} />
      </View>

      <SectionLabel style={styles.toolkitLabel}>Tool Kit</SectionLabel>
      <View style={styles.toolkitRow}>
        {TOOL_KIT.map((tool) => (
          <Card key={tool} tier="deep" style={styles.toolCard}>
            <Body style={styles.toolText}>{tool}</Body>
          </Card>
        ))}
      </View>
      <Body variant="small" style={styles.toolkitHint}>
        Calculators, plate math and timers — one tap away during any workout, even offline.
      </Body>

      <SectionLabel style={styles.historyLabel}>Past workouts</SectionLabel>
    </View>
  );

  return (
    // The list owns the bottom inset (listContent), as on the Library tab.
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <FlatList
        data={past}
        keyExtractor={(item) => item.workout.id}
        renderItem={({ item }) => (
          <WorkoutListItem
            summary={item}
            onPress={() => router.push({ pathname: '/workout/[id]', params: { id: item.workout.id } })}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loaded ? <EmptyState icon="barbell-outline" message="Finished workouts show up here." /> : undefined
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  toolkitLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  toolkitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  toolCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexGrow: 1,
    alignItems: 'center',
  },
  toolText: {
    fontFamily: fonts.subBold,
    color: colors.text,
  },
  toolkitHint: {
    marginTop: spacing.md,
  },
  historyLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
});
