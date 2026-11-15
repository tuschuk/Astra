/**
 * OneRmCalculator — the Tool Kit's 1RM calculator (TK-1).
 *
 * What it shows: a weight box (in the lifter's unit) and a reps box, and below them the
 * estimated one-rep max for that set, worked out by `@training-math`'s Epley formula — plus a
 * small table of the weight that 1RM suggests for 2 to 10 reps, so one answer doubles as a
 * loading chart. The formula's published source is printed with every answer, and the answer is
 * labeled an estimate (CLAUDE.md: numeric performance claims cite a source). A single (1 rep)
 * isn't estimated at all: the weight you actually lifted once *is* your 1RM.
 *
 * What the lifter can do: type a weight and reps (1–30). The answer updates as they type; a
 * box that can't be used says why in red. What's typed is remembered while the app is open
 * (`toolkit/session.ts`), so closing and reopening the Tool Kit mid-workout keeps it.
 *
 * Works with no signal — nothing here leaves the phone.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { epleyE1rm, MAX_EPLEY_REPS, weightForReps, type WeightUnit } from '@training-math';

import { Body } from '@/components/ui/Text';
import { readWeightKg, readWholeNumber } from '@/toolkit/inputs';
import { getToolKitSession, updateToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';
import { colors, spacing } from '@/theme';

import { ResultCard } from './ResultCard';
import { NumberField, WeightField } from './WeightField';

/** The rep counts the "what can I do for N reps" table lists. */
export const REP_TABLE_REPS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** The source line printed with every estimate. */
export const EPLEY_CITATION =
  'Estimated with the Epley formula: weight × (1 + reps ÷ 30). Epley, B. (1985), Poundage Chart, Boyd Epley Workout, Body Enterprises.';

interface OneRmCalculatorProps {
  /** The lifter's display unit: what they type in and what the answer is shown in. */
  unit: WeightUnit;
}

export function OneRmCalculator({ unit }: OneRmCalculatorProps) {
  const [weight, setWeight] = useState(() => getToolKitSession().oneRm.weight);
  const [reps, setReps] = useState(() => getToolKitSession().oneRm.reps);

  const weightReading = readWeightKg(weight, unit);
  const repsReading = readWholeNumber(reps, 1, MAX_EPLEY_REPS, 'reps');
  // The estimate in kg, once both boxes hold usable numbers.
  const e1rmKg =
    weightReading.kind === 'ok' && repsReading.kind === 'ok' ? epleyE1rm(weightReading.value, repsReading.value) : null;
  const isSingle = repsReading.kind === 'ok' && repsReading.value === 1;

  return (
    <View style={styles.root}>
      <WeightField
        label="Weight"
        unit={unit}
        value={weight}
        onChangeText={(text) => {
          setWeight(text);
          updateToolKitSession('oneRm', { weight: text });
        }}
        error={weightReading.kind === 'invalid' ? weightReading.message : null}
      />
      <NumberField
        label="Reps"
        value={reps}
        onChangeText={(text) => {
          setReps(text);
          updateToolKitSession('oneRm', { reps: text });
        }}
        error={repsReading.kind === 'invalid' ? repsReading.message : null}
      />
      <ResultCard
        label={isSingle ? '1RM' : 'Estimated 1RM'}
        value={e1rmKg === null ? null : formatWeight(e1rmKg, unit)}
        hint="Enter the weight and reps of a set."
        secondary={isSingle ? 'A single you lifted counts as your 1RM — no estimate needed.' : null}
      >
        {e1rmKg !== null ? (
          <View style={styles.table}>
            <Body variant="small">Estimated weight for</Body>
            {REP_TABLE_REPS.map((n) => (
              <View key={n} style={styles.tableRow}>
                <Body>{n} reps</Body>
                <Body>{formatWeight(weightForReps(e1rmKg, n), unit)}</Body>
              </View>
            ))}
          </View>
        ) : null}
        <Body variant="small" style={styles.citation}>
          {EPLEY_CITATION}
        </Body>
      </ResultCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  table: {
    gap: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  citation: {
    color: colors.muted,
  },
});
