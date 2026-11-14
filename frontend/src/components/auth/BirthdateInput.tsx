/**
 * BirthdateInput — three side-by-side number boxes: month, day, year.
 *
 * Used on the sign-up screen to collect the birthdate the 18+ gate checks.
 * Plain number boxes (rather than a native date picker) look and behave the
 * same on iPhone and Android and need no extra dependency. It only collects
 * what was typed; checking happens in `checkBirthdate` (src/auth/age.ts).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TextField } from '@/components/ui/TextField';
import type { BirthdateFields } from '@/auth/age';
import { spacing } from '@/theme';

interface BirthdateInputProps {
  value: BirthdateFields;
  onChange: (next: BirthdateFields) => void;
}

export function BirthdateInput({ value, onChange }: BirthdateInputProps) {
  // Keep only digits so a stray character can't sneak into the date.
  const set = (key: keyof BirthdateFields) => (text: string) =>
    onChange({ ...value, [key]: text.replace(/\D/g, '') });

  return (
    <View style={styles.row}>
      <TextField
        label="Birth month"
        placeholder="MM"
        keyboardType="number-pad"
        maxLength={2}
        value={value.month}
        onChangeText={set('month')}
        style={styles.short}
      />
      <TextField
        label="Birth day"
        placeholder="DD"
        keyboardType="number-pad"
        maxLength={2}
        value={value.day}
        onChangeText={set('day')}
        style={styles.short}
      />
      <TextField
        label="Birth year"
        placeholder="YYYY"
        keyboardType="number-pad"
        maxLength={4}
        value={value.year}
        onChangeText={set('year')}
        style={styles.long}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  short: {
    flex: 1,
  },
  long: {
    flex: 1.6,
  },
});
