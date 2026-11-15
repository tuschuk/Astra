/**
 * RpeCalculator — the Tool Kit's RPE calculator (TK-2): "I want 5 reps at RPE 8 — what weight?"
 *
 * What it shows: a 1RM box (in the lifter's unit), a row of rep chips (1–12) and a row of RPE
 * chips (6–10 in half steps), and the working weight `@training-math`'s RPE chart gives for
 * that pair — shown exactly, with the nearest weight you can actually load (2.5 kg / 5 lb) and
 * the percentage of the 1RM under it. The chart is derived from the Epley estimate; the 1RM
 * calculator carries the formula's full source.
 *
 * What the lifter can do: type their 1RM and tap a rep count and an RPE. Chips rather than
 * boxes, because there are only a few legal answers and a tap is faster between sets — and a
 * value the chart doesn't cover can't be picked. Everything is remembered while the app is open.
 *
 * Works with no signal — nothing here leaves the phone.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  MAX_RPE,
  MAX_RPE_REPS,
  MIN_RPE,
  MIN_RPE_REPS,
  percentOfOneRm,
  workingWeightFromRpe,
  type WeightUnit,
} from '@training-math';

import { SectionLabel, Body } from '@/components/ui/Text';
import { LOADABLE_STEP, loadableWeight, readWeightKg } from '@/toolkit/inputs';
import { getToolKitSession, updateToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';
import { colors, spacing } from '@/theme';

import { ChoiceChips, type ChoiceOption } from './ChoiceChips';
import { ResultCard } from './ResultCard';
import { WeightField } from './WeightField';

/** Every rep count the RPE chart covers, as chips. */
const REP_OPTIONS: ChoiceOption<number>[] = Array.from({ length: MAX_RPE_REPS - MIN_RPE_REPS + 1 }, (_, i) => {
  const reps = MIN_RPE_REPS + i;
  return { value: reps, label: String(reps), spoken: `${reps} ${reps === 1 ? 'rep' : 'reps'}` };
});

/** Every RPE the chart covers (6, 6.5 … 10), as chips. */
const RPE_OPTIONS: ChoiceOption<number>[] = Array.from({ length: (MAX_RPE - MIN_RPE) * 2 + 1 }, (_, i) => {
  const rpe = MIN_RPE + i / 2;
  return { value: rpe, label: String(rpe), spoken: `RPE ${rpe}` };
});

interface RpeCalculatorProps {
  /** The lifter's display unit: what they type in and what the answer is shown in. */
  unit: WeightUnit;
}

export function RpeCalculator({ unit }: RpeCalculatorProps) {
  const [oneRm, setOneRm] = useState(() => getToolKitSession().rpe.oneRm);
  const [reps, setReps] = useState(() => getToolKitSession().rpe.reps);
  const [rpe, setRpe] = useState(() => getToolKitSession().rpe.rpe);

  const oneRmReading = readWeightKg(oneRm, unit);
  const workingKg = oneRmReading.kind === 'ok' ? workingWeightFromRpe(oneRmReading.value, reps, rpe) : null;

  return (
    <View style={styles.root}>
      <WeightField
        label="1RM"
        unit={unit}
        value={oneRm}
        onChangeText={(text) => {
          setOneRm(text);
          updateToolKitSession('rpe', { oneRm: text });
        }}
        error={oneRmReading.kind === 'invalid' ? oneRmReading.message : null}
      />
      <View style={styles.group}>
        <SectionLabel size="small">Target reps</SectionLabel>
        <ChoiceChips
          options={REP_OPTIONS}
          selected={reps}
          onSelect={(value) => {
            setReps(value);
            updateToolKitSession('rpe', { reps: value });
          }}
        />
      </View>
      <View style={styles.group}>
        <SectionLabel size="small">RPE</SectionLabel>
        <ChoiceChips
          options={RPE_OPTIONS}
          selected={rpe}
          onSelect={(value) => {
            setRpe(value);
            updateToolKitSession('rpe', { rpe: value });
          }}
        />
      </View>
      <ResultCard
        label={`Working weight · ${reps} @ RPE ${rpe}`}
        value={workingKg === null ? null : formatWeight(workingKg, unit)}
        hint="Enter your 1RM."
        secondary={
          workingKg === null
            ? null
            : `Load ${loadableWeight(workingKg, unit)} ${unit} (nearest ${LOADABLE_STEP[unit]} ${unit}) · about ${
                Math.round(percentOfOneRm(reps, rpe) * 10) / 10
              }% of your 1RM`
        }
      >
        <Body variant="small" style={styles.note}>
          An estimate derived from the Epley formula (source on the 1RM calculator). RPE 8 means about 2 reps left in
          the tank.
        </Body>
      </ResultCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  note: {
    color: colors.muted,
  },
});
