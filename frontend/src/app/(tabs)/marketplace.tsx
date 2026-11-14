/**
 * Marketplace — browse and search published training programs
 * (build-list MKT-1..MKT-5). Shows the featured-section skeleton with
 * placeholder program cards so the final layout exists before real
 * programs do.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { colors, spacing, type } from '@/theme';

/** Placeholder cards, typed against the shape MKT-4's program page needs. */
interface ProgramPreview {
  name: string;
  author: string;
  weeks: number;
  daysPerWeek: number;
}

const PLACEHOLDER_PROGRAMS: readonly ProgramPreview[] = [
  { name: 'Starting Strength', author: 'Community', weeks: 12, daysPerWeek: 3 },
  { name: '5/3/1 for Beginners', author: 'Community', weeks: 4, daysPerWeek: 3 },
  { name: 'PHUL', author: 'Community', weeks: 8, daysPerWeek: 4 },
];

export default function MarketplaceScreen() {
  return (
    <Screen>
      <Heading>Marketplace</Heading>
      <Body variant="muted" style={styles.lede}>
        Programs built and ranked by the community.
      </Body>

      <SectionLabel style={styles.sectionLabel}>Featured this week</SectionLabel>
      <View style={styles.list}>
        {PLACEHOLDER_PROGRAMS.map((program) => (
          <Card key={program.name} accent>
            <SectionLabel size="small" style={styles.tag}>
              Program
            </SectionLabel>
            <Body style={styles.programName}>{program.name}</Body>
            <Body variant="small">
              {program.author} · {program.weeks} weeks · {program.daysPerWeek} days/week
            </Body>
          </Card>
        ))}
      </View>
      <Body variant="small" style={styles.hint}>
        Browse, vote and save a program to make it your active plan. Publishing opens when the
        program builder ships.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  tag: {
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  programName: {
    ...type.cardTitle,
    marginBottom: spacing.xs,
  },
  hint: {
    marginTop: spacing.lg,
  },
});
