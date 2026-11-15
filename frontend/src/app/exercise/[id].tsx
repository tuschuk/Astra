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
 * An id that isn't in the library (only reachable by a stale link) shows a plain "not in the
 * library" message instead of crashing. If the database can't be read, only the history part says
 * so; the catalog content still shows.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ExerciseHistorySection } from '@/components/workout/ExerciseHistorySection';
import { BODY_REGION_LABELS, exerciseById } from '@/library/catalog';
import { boldSegments } from '@/library/cueFormat';
import { MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
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
    return (
      <Screen>
        {backButton}
        <EmptyState icon="barbell-outline" message="That exercise isn’t in the library." />
      </Screen>
    );
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
});
