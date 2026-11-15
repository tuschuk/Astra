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
 *   - "Tips": the short form tips for its movement pattern.
 *
 * What the user can do: read it and go Back. An id that isn't in the library (only reachable by a
 * stale link) shows a plain "not in the library" message instead of crashing. The lifter's own
 * history and PRs on this screen arrive in step B30.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { BODY_REGION_LABELS, exerciseById } from '@/library/catalog';
import { boldSegments } from '@/library/cueFormat';
import { MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
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
});
