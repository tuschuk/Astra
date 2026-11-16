/**
 * Workout — the logger's front door (LOG-1) and the app's boldest screen.
 *
 * What it shows:
 *   - with no workout in progress and no program running: **Start empty workout** (starts a blank
 *     workout and opens the logger) and **Start from a program** (opens the program picker; picking
 *     one starts running it, PRG-3, B35);
 *   - with a program running (and no workout in progress): a card naming the program and its next
 *     session ("Next: Week 2 · Day A"), with **Start next session** as the main button — it opens
 *     the logger on that session, its exercises already added with their targets as notes; finishing
 *     it moves the program on to the session after. **Start empty workout** stays below it (an
 *     off-program day never blocks logging, and moves the program nowhere), and **Stop program**
 *     (asks first) ends the run. If the author deleted the rest of the program, the card says there
 *     is no next session and offers Stop;
 *   - with a workout in progress on this phone (even one left behind when the app was killed):
 *     **Resume workout** and **Discard** instead — never a second workout on top of the first (the
 *     program card hides until it is finished or discarded);
 *   - **Your programs** (always): the lifter's own training programs, where they build plans of
 *     weeks → workouts → exercises with targets (PRG-1, PRG-2, B34);
 *   - the Tool Kit tiles: 1RM, RPE, %1RM, Plates and Timer each open the Tool Kit panel
 *     straight at that tool (TK-1..TK-5), so a lifter can plan — or run a conditioning timer —
 *     without starting a workout;
 *   - the lifter's finished workouts, newest first (the latest 100), each opening the saved
 *     workout with every set.
 *
 * Every time the tab comes into view it re-checks the phone's database, so the list, the program
 * card and the Resume button are always current (after finishing a workout, after a relaunch…).
 * Everything shown comes from the phone, so it works with no signal.
 */
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ProgramPickerSheet } from '@/components/programs/ProgramPickerSheet';
import { TOOL_OPTIONS, ToolKitSheet } from '@/components/toolkit/ToolKitSheet';
import type { ToolId } from '@/toolkit/session';
import { WorkoutListItem } from '@/components/workout/WorkoutListItem';
import { confirmDiscardWorkout } from '@/components/workout/confirmDiscardWorkout';
import { useAppDatabase } from '@/db/useAppDatabase';
import { programSessionLabel, readActiveRun, stopProgramRun, type ActiveProgramRun } from '@/programs/programRuns';
import { useDisplayUnit } from '@/settings/displayUnit';
import { clearSessionWorkout, resumeSessionWorkout, startSessionWorkout } from '@/workout/activeWorkoutSession';
import { listPastWorkouts, type PastWorkoutSummary } from '@/workout/history';
import { startProgramSession } from '@/workout/startProgramSession';
import { useSessionWorkout } from '@/workout/useActiveWorkout';
import { colors, fonts, spacing, type } from '@/theme';

/** Asks before stopping the program being run; `onConfirm` runs only if the lifter confirms. */
function confirmStopProgram(onConfirm: () => void): void {
  Alert.alert('Stop this program?', 'Your logged sessions stay. Starting it again later begins at Week 1.', [
    { text: 'Keep going', style: 'cancel' },
    { text: 'Stop program', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function WorkoutScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const active = useSessionWorkout(userId);
  const unit = useDisplayUnit();
  const [past, setPast] = useState<PastWorkoutSummary[]>([]);
  // The program being run (B35), tagged by lifter so an account switch never shows the last one's.
  const [run, setRun] = useState<{ forUser: string; value: ActiveProgramRun | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which tool's tile was tapped (the Tool Kit is open at it), or null when closed.
  const [openTool, setOpenTool] = useState<ToolId | null>(null);

  /** Re-reads the workout in progress (into the session slot), the program run and the history list. */
  const refresh = useCallback(async () => {
    if (!db || !userId) return;
    try {
      await resumeSessionWorkout(db, userId);
      setRun({ forUser: userId, value: await readActiveRun(db, userId) });
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

  /** Starts the running program's next session, prefilled, and opens the logger (PRG-3). */
  async function startNext(): Promise<void> {
    if (!db || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startProgramSession(db, userId, unit);
      router.push('/active-workout');
    } catch (caught) {
      // A workout may have been started elsewhere, or the program changed: re-read and show that.
      console.warn('Workout tab: could not start the next session', caught);
      setError('The next session couldn’t be started. If a workout is in progress, resume it.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Asks first, then ends the program being run. */
  function confirmStop(): void {
    if (!db || !userId || busy) return;
    confirmStopProgram(() => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          await stopProgramRun(db, userId);
          await refresh();
        } catch (caught) {
          console.warn('Workout tab: could not stop the program', caught);
          setError('The program couldn’t be stopped. Try again.');
        } finally {
          setBusy(false);
        }
      })();
    });
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
  const activeRun = run && run.forUser === userId ? run.value : null;

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
        ) : activeRun ? (
          <>
            <Card style={styles.runCard}>
              <SectionLabel size="small">Running</SectionLabel>
              <Body style={styles.runName}>{activeRun.tree.program.name}</Body>
              <Body variant="muted">
                {activeRun.nextSession
                  ? `Next: ${programSessionLabel(activeRun.nextSession)}`
                  : 'This program has no next session.'}
              </Body>
            </Card>
            {activeRun.nextSession ? (
              <Button label="Start next session" onPress={() => void startNext()} disabled={!ready || busy} />
            ) : null}
            <Button
              label="Start empty workout"
              onPress={() => void start()}
              variant={activeRun.nextSession ? 'outline' : 'primary'}
              disabled={!ready || busy}
            />
            <Button label="Stop program" onPress={confirmStop} variant="ghost" disabled={!ready || busy} />
          </>
        ) : (
          <>
            <Button label="Start empty workout" onPress={() => void start()} disabled={!ready || busy} />
            <Button
              label="Start from a program"
              onPress={() => setPickerOpen(true)}
              variant="ghost"
              disabled={!ready || busy}
            />
          </>
        )}
        {/* The program builder (B34) — always available, even mid-workout. */}
        <Button label="Your programs" onPress={() => router.push('/programs')} variant="outline" />
        <FormError message={dbError ? 'This phone’s workout storage couldn’t be opened.' : error} />
      </View>

      <SectionLabel accessibilityRole="header" style={styles.toolkitLabel}>
        Tool Kit
      </SectionLabel>
      <View style={styles.toolkitRow}>
        {TOOL_OPTIONS.map((tool) => (
          <Pressable
            key={tool.value}
            accessibilityRole="button"
            accessibilityLabel={`Open ${tool.spoken}`}
            onPress={() => setOpenTool(tool.value)}
            style={({ pressed }) => [styles.toolTile, pressed && styles.toolTilePressed]}
          >
            <Card tier="deep" style={styles.toolCard}>
              <Body style={styles.toolText}>{tool.label}</Body>
            </Card>
          </Pressable>
        ))}
      </View>
      <Body variant="small" style={styles.toolkitHint}>
        Calculators, plate math and a workout timer — tap one here, or the Tool Kit button during any workout.
        Works offline.
      </Body>

      <SectionLabel accessibilityRole="header" style={styles.historyLabel}>
        Past workouts
      </SectionLabel>
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
      <ToolKitSheet
        visible={openTool !== null}
        initialTool={openTool ?? undefined}
        onClose={() => setOpenTool(null)}
      />
      <ProgramPickerSheet
        visible={pickerOpen}
        db={db}
        userId={userId}
        onStarted={() => {
          setPickerOpen(false);
          void refresh();
        }}
        onOpenPrograms={() => {
          setPickerOpen(false);
          router.push('/programs');
        }}
        onClose={() => setPickerOpen(false)}
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
  runCard: {
    gap: spacing.xs,
  },
  runName: {
    ...type.cardTitle,
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
  toolTile: {
    flexGrow: 1,
  },
  toolTilePressed: {
    opacity: 0.7,
  },
  toolCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
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
