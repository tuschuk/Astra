/**
 * Workout — the logger's front door (build-list LOG-1) and the app's boldest
 * screen. Shows the start-workout actions and a preview of the Tool Kit
 * (TK-1..TK-5). The buttons are placeholders until the logger lands; they
 * render the final visual design so every later feature builds inside it.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { colors, fonts, spacing } from '@/theme';

/** The five Tool Kit utilities, in the order they'll ship (TK-1..TK-5). */
const TOOL_KIT = ['1RM', 'RPE', '%1RM', 'Plates', 'Timer'] as const;

export default function WorkoutScreen() {
  return (
    <Screen>
      <Heading size="display">Workout</Heading>
      <Body variant="muted" style={styles.lede}>
        Log every set, catch every PR.
      </Body>

      <View style={styles.actions}>
        {/* Wired to the logger when LOG-1 lands. */}
        <Button label="Start empty workout" onPress={() => {}} />
        <Button label="Start from a program" onPress={() => {}} variant="ghost" />
      </View>

      <SectionLabel style={styles.toolkitLabel}>Tool Kit</SectionLabel>
      <View style={styles.toolkitRow}>
        {TOOL_KIT.map((tool) => (
          <Card key={tool} tier="deep" style={styles.toolCard}>
            <Body style={styles.toolText}>{tool}</Body>
          </Card>
        ))}
      </View>
      <Body variant="small" style={styles.toolkitHint}>
        Calculators, plate math and timers — one tap away during any workout, even offline.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  toolkitLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  toolkitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  toolCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexGrow: 1,
    alignItems: 'center',
  },
  toolText: {
    fontFamily: fonts.subBold,
    color: colors.text,
  },
  toolkitHint: {
    marginTop: spacing.md,
  },
});
