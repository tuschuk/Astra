/**
 * NumberField — a labeled number box for the Tool Kit calculators, with its problem (if any)
 * shown in red underneath.
 *
 * What it shows: the field name with its unit ("1RM (kg)", "Reps"), the box, and an inline
 * message such as "Enter a weight above 0 and up to 10000." when what's typed can't be used.
 *
 * What the lifter can do: type a number. Weight boxes bring up the decimal keypad (so 102.5
 * is easy); rep boxes the whole-number keypad. The box reports every keystroke to the
 * calculator, which decides what it means.
 *
 * `WeightField` is the same box preset for a weight in a given unit — the label carries the unit
 * so the lifter always knows which unit they are typing in.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WeightUnit } from '@training-math';

import { FormError } from '@/components/ui/FormError';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/theme';

interface NumberFieldProps {
  /** The full field name, read aloud too ("Reps", "Bar (lb)"). */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** The inline problem with what's typed, or null for none. */
  error: string | null;
  /** True for a box that takes decimals (weights, percentages). */
  decimal?: boolean;
  placeholder?: string;
}

export function NumberField({ label, value, onChangeText, error, decimal = false, placeholder }: NumberFieldProps) {
  return (
    <View style={styles.wrapper}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        placeholder={placeholder}
        autoCorrect={false}
      />
      <FormError message={error} />
    </View>
  );
}

interface WeightFieldProps extends Omit<NumberFieldProps, 'label' | 'decimal'> {
  /** What the weight is ("Weight", "1RM"); the unit is added to it. */
  label: string;
  unit: WeightUnit;
}

/** A decimal number box whose label names the unit: "1RM (kg)". */
export function WeightField({ label, unit, ...rest }: WeightFieldProps) {
  return <NumberField label={`${label} (${unit})`} decimal {...rest} />;
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
});
