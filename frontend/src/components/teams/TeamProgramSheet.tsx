/**
 * TeamProgramSheet — a program or workout a coach pushed to the team, or a program a coach
 * assigned to you (B37 — TEAM-3).
 *
 * What it shows: a full-screen panel with the program's name and every week ("Week 1…"), each
 * with its workouts and their exercises and targets ("Back Squat — 3 × 5 @ 225 lb · RPE 8",
 * weight in the lifter's unit). For one pushed workout: its name, the program it comes from, and
 * its exercises. If the content is gone (the coach deleted it, or you left the team) it says
 * "This program is no longer available."
 *
 * What the lifter can do, by how they got here — the footer button:
 *   - an assignment → **Start program**: copies it into your programs and starts running it;
 *   - a pushed program → **Save to my programs**: copies it, no run started;
 *   - a pushed workout → **Start this workout**: opens the logger on it, prefilled.
 * Or **Close**. The sheet only shows and reports the tap; the team page does the work and passes
 * back a busy flag and any message (a refusal, or "2 exercises are the coach's own…").
 */
import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WeightUnit } from '@training-math';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { DELETED_EXERCISE_NAME, formatProgramTargets } from '@/programs/programs';
import {
  payloadWorkoutLabel,
  type PayloadSlot,
  type PayloadWorkout,
  type TeamProgramPayload,
  type TeamWorkoutPayload,
} from '@/social/teamCoaching';
import { colors, layout, spacing, type } from '@/theme';

/** Shown when the server no longer hands the content over. */
export const PUSH_UNAVAILABLE = 'This program is no longer available.';

/** What the sheet is showing, and so which button its footer offers. */
export type TeamSheetContent =
  | { kind: 'assignment'; payload: TeamProgramPayload | null }
  | { kind: 'program'; payload: TeamProgramPayload | null }
  | { kind: 'workout'; payload: TeamWorkoutPayload | null };

/** The footer button's words for each kind of content. */
export const SHEET_ACTION_LABEL: Record<TeamSheetContent['kind'], string> = {
  assignment: 'Start program',
  program: 'Save to my programs',
  workout: 'Start this workout',
};

export interface TeamProgramSheetProps {
  /** What to show; null closes the sheet. */
  content: TeamSheetContent | null;
  /** The lifter's display unit, for target weights. */
  unit: WeightUnit;
  /** True while the team page is carrying out the footer action. */
  busy: boolean;
  /** True once the footer action succeeded: the button goes away (a second tap would copy again). */
  done?: boolean;
  /** A line under the content: a refusal, or how the action went. */
  message: string | null;
  /** The footer button was tapped. */
  onAction: () => void;
  /** Close was tapped. */
  onClose: () => void;
}

/** One exercise slot as a line: its name and its targets. */
function SlotLine({ slot, unit }: { slot: PayloadSlot; unit: WeightUnit }) {
  const targets = formatProgramTargets(
    {
      target_sets: slot.targetSets,
      target_reps: slot.targetReps,
      target_weight_kg: slot.targetWeightKg,
      target_rpe: slot.targetRpe,
    },
    unit,
  );
  return (
    <View style={styles.slot}>
      <Body style={styles.slotName}>{slot.exerciseName ?? DELETED_EXERCISE_NAME}</Body>
      <Body variant="small">{targets}</Body>
    </View>
  );
}

/** One workout's card: its label and its slots. */
function WorkoutCard({ workout, label, unit }: { workout: PayloadWorkout; label: string; unit: WeightUnit }) {
  return (
    <Card style={styles.card}>
      <Body style={styles.workoutName}>{label}</Body>
      {workout.exercises.length === 0 ? <Body variant="small">No exercises yet.</Body> : null}
      {workout.exercises.map((slot, i) => (
        <SlotLine key={`${slot.position}-${i}`} slot={slot} unit={unit} />
      ))}
    </Card>
  );
}

export function TeamProgramSheet({ content, unit, busy, done = false, message, onAction, onClose }: TeamProgramSheetProps) {
  const insets = useSafeAreaInsets();
  const payload = content?.payload ?? null;

  let heading = 'Program';
  let body: React.ReactNode = <EmptyState icon="calendar-outline" message={PUSH_UNAVAILABLE} />;
  if (content?.kind === 'workout' && content.payload) {
    const w = content.payload;
    heading = payloadWorkoutLabel(w, w.position + 1);
    body = (
      <>
        <SectionLabel size="small">From {w.programName}</SectionLabel>
        <WorkoutCard workout={w} label={heading} unit={unit} />
      </>
    );
  } else if (content && content.kind !== 'workout' && content.payload) {
    const p = content.payload;
    heading = p.name;
    body =
      p.weeks.length === 0 ? (
        <Body variant="muted">This program has no weeks yet.</Body>
      ) : (
        p.weeks.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.week}>
            <SectionLabel>Week {weekIndex + 1}</SectionLabel>
            {week.workouts.map((workout, i) => (
              <WorkoutCard key={`w-${i}`} workout={workout} label={payloadWorkoutLabel(workout, i + 1)} unit={unit} />
            ))}
          </View>
        ))
      );
  }

  return (
    <Modal visible={content !== null} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section" style={styles.title}>
            {heading}
          </Heading>
          <Button label="Close" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}>{body}</ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {message ? <Body variant="small">{message}</Body> : null}
          {content && payload && !done ? (
            <Button label={SHEET_ACTION_LABEL[content.kind]} onPress={onAction} disabled={busy} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: layout.screenPadding,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    flexShrink: 1,
  },
  week: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.xs,
  },
  workoutName: {
    ...type.cardTitle,
  },
  slot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  slotName: {
    color: colors.text,
    flexShrink: 1,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
});
