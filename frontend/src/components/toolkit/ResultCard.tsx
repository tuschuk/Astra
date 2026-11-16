/**
 * ResultCard — the big answer box at the bottom of each Tool Kit calculator.
 *
 * What it shows: a small label ("Estimated 1RM"), the answer in large type ("116.7 kg"), an
 * optional second line under it (the nearest loadable weight, or how short a rack falls), and
 * any extra content passed in (a rep table, a plate list, the formula's source). Before the
 * lifter has typed enough to answer, it shows a muted hint instead of a number.
 *
 * Nothing to tap — it only shows. Screen readers hear the label, the answer and the second
 * line as one phrase.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Body, SectionLabel } from '@/components/ui/Text';
import { colors, fontScaleCaps, spacing, type } from '@/theme';

interface ResultCardProps {
  /** What the answer is ("Working weight"). */
  label: string;
  /** The answer, already formatted with its unit, or null while there isn't one yet. */
  value: string | null;
  /** Shown in place of the answer while `value` is null ("Enter a weight and reps."). */
  hint: string;
  /** An optional smaller line under the answer. */
  secondary?: string | null;
  children?: React.ReactNode;
}

export function ResultCard({ label, value, hint, secondary, children }: ResultCardProps) {
  return (
    <Card accent style={styles.card}>
      <View
        accessible
        accessibilityLabel={
          value === null ? `${label}: ${hint}` : secondary ? `${label}: ${value}. ${secondary}` : `${label}: ${value}`
        }
      >
        <SectionLabel>{label}</SectionLabel>
        {value === null ? (
          <Body variant="muted" style={styles.hint}>
            {hint}
          </Body>
        ) : (
          <Text maxFontSizeMultiplier={fontScaleCaps.display} style={styles.value}>
            {value}
          </Text>
        )}
        {value !== null && secondary ? <Body variant="muted">{secondary}</Body> : null}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  value: {
    ...type.display,
    color: colors.text,
    marginTop: spacing.xs,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
