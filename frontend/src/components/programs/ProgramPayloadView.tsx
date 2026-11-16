/**
 * ProgramPayloadView — a program someone else wrote, shown in full: every week ("Week 1…"), each
 * with its workouts as cards ("Day A", or "Workout N" when unnamed), each card listing its
 * exercises and their targets ("Back Squat — 3 × 5 @ 225 lb · RPE 8", weight in the lifter's
 * display unit). A program with no weeks says "This program has no weeks yet."
 *
 * It only shows — nothing on it can be tapped. It is the ONE way the app draws a program the
 * server handed over as JSON (the shape `parseProgramPayload` produces): the team sheet shows a
 * coach's pushed or assigned program with it (B37), and the Marketplace program page shows a
 * published program's "full workout breakdown" with it (B40, MKT-4). `PayloadWorkoutCard` is
 * exported for the team sheet's single pushed workout.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WeightUnit } from '@training-math';

import { Card } from '@/components/ui/Card';
import { Body, SectionLabel } from '@/components/ui/Text';
import { DELETED_EXERCISE_NAME, formatProgramTargets } from '@/programs/programs';
import { payloadWorkoutLabel, type PayloadSlot, type PayloadWorkout, type TeamProgramPayload } from '@/social/teamCoaching';
import { colors, spacing, type } from '@/theme';

/** One exercise slot as a line: its name (or "Deleted exercise") and its targets. */
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

/** One workout's card: its label and every exercise slot with its targets. */
export function PayloadWorkoutCard({ workout, label, unit }: { workout: PayloadWorkout; label: string; unit: WeightUnit }) {
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

export interface ProgramPayloadViewProps {
  /** The program to show. */
  payload: TeamProgramPayload;
  /** The lifter's display unit, for target weights. */
  unit: WeightUnit;
}

/** Every week of the program, in order, each with its workout cards. */
export function ProgramPayloadView({ payload, unit }: ProgramPayloadViewProps) {
  if (payload.weeks.length === 0) return <Body variant="muted">This program has no weeks yet.</Body>;
  return (
    <>
      {payload.weeks.map((week, weekIndex) => (
        <View key={`week-${weekIndex}`} style={styles.week}>
          <SectionLabel>Week {weekIndex + 1}</SectionLabel>
          {week.workouts.map((workout, i) => (
            <PayloadWorkoutCard key={`w-${i}`} workout={workout} label={payloadWorkoutLabel(workout, i + 1)} unit={unit} />
          ))}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
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
});
