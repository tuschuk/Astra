/**
 * IntensityCalculator — the Tool Kit's intensity calculator (TK-3): "what is 85% of my 1RM?"
 *
 * What it shows: a 1RM box (in the lifter's unit) and a percentage box, and the working weight
 * `@training-math` gives for that percentage — exactly, with the nearest loadable weight
 * (2.5 kg / 5 lb) under it. Percentages past 100 are allowed, up to the module's ceiling
 * (150 %), because overloads and supported holds are real training.
 *
 * What the lifter can do: type a 1RM and a percentage (decimals fine). A percentage of 0 or
 * past the ceiling is refused with a message naming the allowed range, so the math is never
 * asked for an answer it doesn't give. Everything is remembered while the app is open.
 *
 * Works with no signal — nothing here leaves the phone.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { workingWeightFromPercent, type WeightUnit } from '@training-math';

import { LOADABLE_STEP, loadableWeight, readPercent, readWeightKg } from '@/toolkit/inputs';
import { getToolKitSession, updateToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';
import { spacing } from '@/theme';

import { ResultCard } from './ResultCard';
import { NumberField, WeightField } from './WeightField';

interface IntensityCalculatorProps {
  /** The lifter's display unit: what they type in and what the answer is shown in. */
  unit: WeightUnit;
}

export function IntensityCalculator({ unit }: IntensityCalculatorProps) {
  const [oneRm, setOneRm] = useState(() => getToolKitSession().percent.oneRm);
  const [percent, setPercent] = useState(() => getToolKitSession().percent.percent);

  const oneRmReading = readWeightKg(oneRm, unit);
  const percentReading = readPercent(percent);
  const workingKg =
    oneRmReading.kind === 'ok' && percentReading.kind === 'ok'
      ? workingWeightFromPercent(oneRmReading.value, percentReading.value)
      : null;

  return (
    <View style={styles.root}>
      <WeightField
        label="1RM"
        unit={unit}
        value={oneRm}
        onChangeText={(text) => {
          setOneRm(text);
          updateToolKitSession('percent', { oneRm: text });
        }}
        error={oneRmReading.kind === 'invalid' ? oneRmReading.message : null}
      />
      <NumberField
        label="Percent of 1RM (%)"
        decimal
        value={percent}
        onChangeText={(text) => {
          setPercent(text);
          updateToolKitSession('percent', { percent: text });
        }}
        error={percentReading.kind === 'invalid' ? percentReading.message : null}
      />
      <ResultCard
        label={percentReading.kind === 'ok' ? `Working weight · ${percentReading.value}%` : 'Working weight'}
        value={workingKg === null ? null : formatWeight(workingKg, unit)}
        hint="Enter your 1RM and a percentage."
        secondary={
          workingKg === null ? null : `Load ${loadableWeight(workingKg, unit)} ${unit} (nearest ${LOADABLE_STEP[unit]} ${unit})`
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
});
