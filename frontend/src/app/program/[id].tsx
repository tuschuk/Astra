/**
 * Program page — one of the lifter's programs, and the place it is built (PRG-1, PRG-2, B34).
 * Only its author can open it (it reads the lifter's own programs on the phone; others see shared
 * programs online — B40), so the page IS the editor.
 *
 * What it shows: the program's name in an editable box, then (B39) "Who can see this" — the
 * visibility chips, and the Team share list when Team is chosen (`ProgramVisibilitySection`) —
 * then its weeks in order as sections —
 * "Week 1", "Week 2", … — each listing its workouts ("Day A", or "Workout N" when unnamed) with
 * how many exercises each holds. This is the week → workout → exercise structure made visible.
 *
 * What the lifter can do:
 *   - rename the program (it saves itself a moment after typing stops);
 *   - (B39) choose who can see it — Only you, Followers, Team or Published — offline too; with
 *     Team chosen, tick the Teams to share it with (that list needs a connection);
 *   - **Add week** at the end; per week, **Add workout** or **Remove week** (asks first);
 *   - tap a workout to open its editor (exercises and targets); **Remove** a workout (asks first);
 *   - **Delete program** (asks first), which returns to the Programs list.
 * The structure is enforced by construction: workouts can only be added inside a week, and
 * exercises only inside a workout (on the workout's own screen).
 *
 * Everything is read from and saved to the phone (no signal needed) and re-read whenever the page
 * comes back into view. An unknown, deleted, or someone else's program id shows a plain "not
 * found" state; a database that can't be read says so instead.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MAX_PROGRAM_NAME_LENGTH } from '@training-math';

import { useAuth } from '@/auth/AuthProvider';
import { AutosaveNameField } from '@/components/programs/AutosaveNameField';
import { confirmProgramRemoval } from '@/components/programs/confirmProgramRemoval';
import { ProgramVisibilitySection } from '@/components/programs/ProgramVisibilitySection';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import {
  addProgramWorkout,
  addWeek,
  deleteProgram,
  readProgramTree,
  removeProgramWorkout,
  removeWeek,
  renameProgram,
  setProgramVisibility,
  type ProgramTree,
} from '@/programs/programs';
import { colors, spacing, type } from '@/theme';

/** Reading; found; not found (unknown, deleted or not the lifter's); or the read failed. */
type Load = { status: 'loading' } | { status: 'found'; tree: ProgramTree } | { status: 'missing' } | { status: 'failed' };

/** "1 exercise" / "3 exercises". */
function exerciseCount(n: number): string {
  return `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
}

export default function ProgramScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const programId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const [loaded, setLoaded] = useState<{ forId: string; state: Load } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const client = useMemo(() => getSupabase(), []);

  const state: Load = dbError
    ? { status: 'failed' }
    : !session || programId === ''
      ? { status: 'missing' }
      : loaded && loaded.forId === programId
        ? loaded.state
        : { status: 'loading' };

  /** Re-reads the whole program from the phone. */
  const refresh = useCallback(async () => {
    if (!db || !userId || programId === '') return;
    try {
      const tree = await readProgramTree(db, userId, programId);
      setLoaded({ forId: programId, state: tree ? { status: 'found', tree } : { status: 'missing' } });
    } catch (caught) {
      console.warn('Program: could not read the program', caught);
      setLoaded({ forId: programId, state: { status: 'failed' } });
    }
  }, [db, userId, programId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /** Back to the Programs list (or wherever this was opened from). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/programs');
  }

  /** Runs one change at a time, then re-reads; a failure shows one line under the header. */
  async function change(action: () => Promise<unknown>, failure: string): Promise<void> {
    if (running.current || !db || !userId) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      console.warn('Program: a change could not be saved', caught);
      setError(failure);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status === 'loading') return <Screen>{backButton}</Screen>;
  if (state.status === 'missing') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="calendar-outline" message="That program isn’t one of yours, or it was deleted." />
      </Screen>
    );
  }
  if (state.status === 'failed') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="alert-circle-outline" message="This program couldn’t be read from this phone." />
      </Screen>
    );
  }

  // Both are known once the tree loaded (it is only read with a database and a lifter).
  if (!db || !userId) return <Screen>{backButton}</Screen>;
  const { tree } = state;
  const database = db;
  const lifter = userId;

  return (
    <Screen>
      {backButton}
      <Heading>{tree.program.name}</Heading>
      <View style={styles.nameField}>
        <AutosaveNameField
          // Remount per program so the box never shows another program's name.
          key={tree.program.id}
          label="Program name"
          initial={tree.program.name}
          save={async (text) => {
            await renameProgram(database, lifter, tree.program.id, text);
            await refresh();
          }}
          errorMessage={`Give the program a name of 1 to ${MAX_PROGRAM_NAME_LENGTH} characters.`}
        />
      </View>
      <ProgramVisibilitySection
        programId={tree.program.id}
        visibility={tree.program.visibility}
        userId={lifter}
        client={client}
        onSelect={(visibility) =>
          void change(
            () => setProgramVisibility(database, lifter, tree.program.id, visibility),
            'Who can see this couldn’t be changed. Try again.',
          )
        }
      />
      <FormError message={error} />

      {tree.weeks.length === 0 ? (
        <Body variant="muted" style={styles.hint}>
          Start with a week, then add the workouts you’ll do in it.
        </Body>
      ) : null}

      {tree.weeks.map((weekNode) => (
        <Card key={weekNode.week.id} style={styles.week}>
          <SectionLabel>{`Week ${weekNode.number}`}</SectionLabel>
          {weekNode.workouts.length === 0 ? <Body variant="muted">No workouts in this week yet.</Body> : null}
          {weekNode.workouts.map((workoutNode) => (
            <View key={workoutNode.workout.id} style={styles.workoutRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open Week ${weekNode.number} ${workoutNode.label}`}
                onPress={() =>
                  router.push({ pathname: '/program-workout/[id]', params: { id: workoutNode.workout.id } })
                }
                style={({ pressed }) => [styles.workoutLink, pressed && styles.pressed]}
              >
                <Body style={styles.workoutName}>{workoutNode.label}</Body>
                <SectionLabel size="small">{exerciseCount(workoutNode.exercises.length)}</SectionLabel>
              </Pressable>
              <Button
                label="Remove"
                variant="ghost"
                disabled={busy}
                accessibilityLabel={`Remove Week ${weekNode.number} ${workoutNode.label}`}
                onPress={() =>
                  confirmProgramRemoval('workout', () =>
                    void change(
                      () => removeProgramWorkout(database, lifter, workoutNode.workout.id),
                      'That workout couldn’t be removed. Try again.',
                    ),
                  )
                }
              />
            </View>
          ))}
          <View style={styles.weekActions}>
            <Button
              label="Add workout"
              variant="outline"
              disabled={busy}
              accessibilityLabel={`Add workout to Week ${weekNode.number}`}
              onPress={() =>
                void change(
                  () => addProgramWorkout(database, lifter, weekNode.week.id),
                  'That workout couldn’t be added. Try again.',
                )
              }
            />
            <Button
              label="Remove week"
              variant="ghost"
              disabled={busy}
              accessibilityLabel={`Remove Week ${weekNode.number}`}
              onPress={() =>
                confirmProgramRemoval('week', () =>
                  void change(
                    () => removeWeek(database, lifter, weekNode.week.id),
                    'That week couldn’t be removed. Try again.',
                  ),
                )
              }
            />
          </View>
        </Card>
      ))}

      <Button
        label="Add week"
        disabled={busy}
        style={styles.addWeek}
        onPress={() =>
          void change(() => addWeek(database, lifter, tree.program.id), 'That week couldn’t be added. Try again.')
        }
      />
      <Button
        label="Delete program"
        variant="ghost"
        disabled={busy}
        style={styles.delete}
        onPress={() =>
          confirmProgramRemoval('program', () => {
            setError(null);
            deleteProgram(database, lifter, tree.program.id)
              .then(back)
              .catch((caught: unknown) => {
                console.warn('Program: could not delete', caught);
                setError('That program couldn’t be deleted. Try again.');
              });
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  nameField: {
    marginTop: spacing.lg,
  },
  hint: {
    marginTop: spacing.lg,
  },
  week: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  workoutLink: {
    flex: 1,
    gap: 2,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  workoutName: {
    ...type.cardTitle,
  },
  weekActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  addWeek: {
    marginTop: spacing.xl,
  },
  delete: {
    marginTop: spacing.md,
  },
});
