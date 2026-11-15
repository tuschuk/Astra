/**
 * Exercise detail — one library exercise's card, opened from the Library tab (LIB-3).
 *
 * What it shows, all from the founder's imported library bundled with the app (no network, so it
 * works with no signal):
 *   - the exercise's name, body region, equipment and movement pattern(s);
 *   - "Muscles worked": every muscle it trains, most direct first (the same ranking the muscle map
 *     uses, so the two never disagree);
 *   - "How to do it": the five imported coaching steps, numbered, each a bold title and its cue
 *     (the cue's own **emphasis** drawn bold);
 *   - "Tips": the short form tips for its movement pattern;
 *   - "Your history" (LIB-4): the lifter's current PRs on this movement and every session they
 *     have logged of it, read from the phone's database through the same `ExerciseHistorySection`
 *     the per-exercise history screen uses — so the numbers here always match that screen. The
 *     catalog slug in the link is turned into the exercise's database id with `libraryExerciseId`.
 *     The coaching content comes first because the session list can be long.
 *
 * What the user can do: read it, reveal older sessions with "Show older sessions", and go Back.
 * If the database can't be read, only the history part says so; the catalog content still shows.
 *
 * Custom exercises (LIB-5, B31): an id that isn't a catalog slug is looked up as one of the
 * signed-in lifter's own exercises (its database id). Found, it shows that exercise's card — name,
 * "Custom", its equipment and main muscle, Edit and Delete, and the same "Your history" section.
 * Not found (a stale link, a deleted exercise, or someone else's — the phone only ever finds the
 * lifter's own), it shows a plain "not in the library" message instead of crashing; if the phone's
 * database can't be read it says that instead, never claiming the exercise doesn't exist.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { confirmDeleteCustomExercise } from '@/components/library/confirmDeleteCustomExercise';
import { CustomExerciseForm } from '@/components/library/CustomExerciseForm';
import { CustomPill } from '@/components/library/CustomPill';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ExerciseHistorySection } from '@/components/workout/ExerciseHistorySection';
import type { ExerciseRow } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { BODY_REGION_LABELS, exerciseById } from '@/library/catalog';
import { boldSegments } from '@/library/cueFormat';
import { deleteCustomExercise, getCustomExercise } from '@/library/customExercises';
import { asMuscleKey, MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
import { libraryExerciseId } from '@/library/uuidv5';
import { colors, radii, spacing, type } from '@/theme';

/** One coaching cue as text, with the founder's `**emphasis**` drawn bold. */
function CueText({ cue }: { cue: string }) {
  return (
    <Text style={type.body}>
      {boldSegments(cue).map((segment, index) =>
        segment.bold ? (
          <Text key={index} style={styles.bold}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

/** The plain "not in the library" state: a stale link, or an exercise this lifter can't see. */
function NotFound({ backButton }: { backButton: React.ReactNode }) {
  return (
    <Screen>
      {backButton}
      <EmptyState icon="barbell-outline" message="That exercise isn’t in the library." />
    </Screen>
  );
}

/**
 * Reading the custom exercise; found; not found (not one of the lifter's live exercises); or the
 * phone's database couldn't be read — kept apart from "not found" so a read failure never tells
 * the lifter their own exercise doesn't exist.
 */
type CustomLoad =
  | { status: 'loading' }
  | { status: 'found'; row: ExerciseRow }
  | { status: 'missing' }
  | { status: 'failed' };

/**
 * The card of one of the lifter's own custom exercises (LIB-5, B31), for an id the catalog doesn't
 * know. Reads the exercise from the phone's database — only the signed-in lifter's own, live
 * (not deleted) exercises are found, so someone else's id or a deleted one shows "not in the
 * library".
 *
 * Shows: the name, a "Custom" pill, its equipment and main muscle if set, Edit and Delete, then
 * "Your history" — the same PRs-and-sessions section as a library card. No coaching steps or
 * tips: there is no authored content for a movement the lifter made up.
 *
 * Edit opens the form with the current values; Delete asks first, then removes it from the
 * Library and the picker (its logged sessions and PRs keep its name) and goes back.
 */
function CustomExerciseDetail({ id, back, backButton }: { id: string; back: () => void; backButton: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const [loaded, setLoaded] = useState<{ forId: string; state: CustomLoad } | null>(null);
  const state: CustomLoad = dbError
    ? { status: 'failed' }
    : !session
      ? { status: 'missing' } // signed out: there is no lifter whose exercise this could be
      : loaded && loaded.forId === id
        ? loaded.state
        : { status: 'loading' };
  const [editKey, setEditKey] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !userId) return;
    let cancelled = false;
    getCustomExercise(db, userId, id)
      .then((row) => {
        if (!cancelled) setLoaded({ forId: id, state: row ? { status: 'found', row } : { status: 'missing' } });
      })
      .catch((caught: unknown) => {
        console.warn('Exercise card: could not read the custom exercise', caught);
        if (!cancelled) setLoaded({ forId: id, state: { status: 'failed' } });
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, id]);

  if (state.status === 'loading') {
    return (
      <Screen>
        {backButton}
      </Screen>
    );
  }
  if (state.status === 'missing') return <NotFound backButton={backButton} />;
  if (state.status === 'failed') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="alert-circle-outline" message="This exercise couldn’t be read from this phone." />
      </Screen>
    );
  }

  const row = state.row;
  const muscle = asMuscleKey(row.primary_muscle);

  /** Asks first, then soft-deletes the exercise and leaves the card. */
  function confirmDelete(): void {
    confirmDeleteCustomExercise(() => {
      if (!db || !userId) return;
      setError(null);
      deleteCustomExercise(db, userId, row.id)
        .then(back)
        .catch((caught: unknown) => {
          console.warn('Exercise card: could not delete the custom exercise', caught);
          setError('That exercise couldn’t be deleted. Try again.');
        });
    });
  }

  return (
    <Screen>
      {backButton}
      <Heading>{row.name}</Heading>

      <View style={styles.metaRow}>
        <CustomPill />
        {row.equipment ? (
          <View style={styles.pill}>
            <SectionLabel size="small">{row.equipment}</SectionLabel>
          </View>
        ) : null}
      </View>
      {muscle ? (
        <Body variant="muted" style={styles.patterns}>
          {MUSCLE_NAMES[muscle]}
        </Body>
      ) : null}

      <View style={styles.actions}>
        <Button label="Edit" variant="outline" onPress={() => setEditKey((k) => (k ?? 0) + 1)} />
        <Button label="Delete" variant="ghost" onPress={confirmDelete} />
      </View>
      {error ? <FormError message={error} /> : null}

      <SectionLabel style={styles.historyLabel}>Your history</SectionLabel>
      <ExerciseHistorySection exerciseId={row.id} />

      {editKey !== null ? (
        <CustomExerciseForm
          key={editKey}
          visible
          db={db}
          userId={userId}
          existing={row}
          onSaved={(saved) => {
            setEditKey(null);
            setLoaded({ forId: id, state: { status: 'found', row: saved } });
          }}
          onClose={() => setEditKey(null)}
        />
      ) : null}
    </Screen>
  );
}

export default function ExerciseDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const exercise = typeof id === 'string' ? exerciseById(id) : undefined;

  /** Back to the Library (or wherever this was opened from); the Library tab if there's no history. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/library');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (!exercise) {
    // Not a catalog slug: it may be one of the lifter's own exercises (a database id).
    if (typeof id === 'string' && id.length > 0) {
      return <CustomExerciseDetail id={id} back={back} backButton={backButton} />;
    }
    return <NotFound backButton={backButton} />;
  }

  const regionColor = colors.category[exercise.body];
  const muscles = rankMuscles(exercise.muscles).map((m) => MUSCLE_NAMES[m]);

  return (
    <Screen>
      {backButton}
      <Heading>{exercise.name}</Heading>

      <View style={styles.metaRow}>
        <View style={styles.region}>
          <View style={[styles.regionDot, { backgroundColor: regionColor }]} />
          <SectionLabel size="small">{BODY_REGION_LABELS[exercise.body]}</SectionLabel>
        </View>
        <View style={styles.pill}>
          <SectionLabel size="small">{exercise.equipment}</SectionLabel>
        </View>
      </View>
      <Body variant="muted" style={styles.patterns}>
        {exercise.patterns.join(' · ')}
      </Body>

      <Card style={styles.card}>
        <SectionLabel size="small">Muscles worked</SectionLabel>
        <Body>{muscles.join(', ')}</Body>
      </Card>

      <Card style={styles.card}>
        <SectionLabel size="small">How to do it</SectionLabel>
        {exercise.steps.map((step, index) => (
          <View key={`${index}-${step.title}`} style={styles.step}>
            <Body style={styles.stepTitle}>
              {index + 1}. {step.title}
            </Body>
            <CueText cue={step.cue} />
          </View>
        ))}
      </Card>

      {exercise.tips.length > 0 ? (
        <Card style={styles.card}>
          <SectionLabel size="small">Tips</SectionLabel>
          {exercise.tips.map((tip, index) => (
            <View key={`${index}-${tip}`} style={styles.tip}>
              <Body style={styles.bullet}>•</Body>
              <Body style={styles.tipText}>{tip}</Body>
            </View>
          ))}
        </Card>
      ) : null}

      <SectionLabel style={styles.historyLabel}>Your history</SectionLabel>
      <ExerciseHistorySection exerciseId={libraryExerciseId(exercise.id)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  region: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  regionDot: {
    width: 8,
    height: 8,
    borderRadius: radii.round,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  patterns: {
    marginTop: spacing.xs,
  },
  card: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  step: {
    gap: spacing.xs,
  },
  stepTitle: {
    ...type.cardTitle,
  },
  bold: {
    fontWeight: '700',
    color: colors.text,
  },
  tip: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    color: colors.muted,
  },
  tipText: {
    flex: 1,
  },
  historyLabel: {
    marginTop: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
