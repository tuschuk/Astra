/**
 * You — the profile (YOU-1..YOU-7): photo, name, bio, follower counts,
 * posts, history, PRs and settings. This foundation renders the profile
 * skeleton — avatar ring, counts row, and the PRs section label — in its
 * final layout with empty values.
 *
 * The gear button in the header opens Settings (B15), where the lifter picks
 * kg or lb, sees which email is signed in, and signs out — the email and
 * sign-out moved there from this screen, so the account has one home.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { colors, layout, radii, spacing, type } from '@/theme';

/** The two follow counts shown on every profile (YOU-1). */
const COUNTS = [
  { label: 'Followers', value: 0 },
  { label: 'Following', value: 0 },
] as const;

/** Size of the round gear button: the platform's minimum touch target. */
const GEAR_SIZE = layout.minTouchTarget;

export default function YouScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatar}>
          {/* Decorative avatar placeholder — the heading names the section. */}
          <Ionicons
            name="person"
            size={36}
            color={colors.muted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </View>
        <View style={styles.identity}>
          <Heading size="section">Your profile</Heading>
        </View>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.counts}>
        {COUNTS.map((count) => (
          <View key={count.label} style={styles.count}>
            <Body style={styles.countValue}>{String(count.value)}</Body>
            <SectionLabel size="small">{count.label}</SectionLabel>
          </View>
        ))}
      </View>

      <SectionLabel style={styles.sectionLabel}>Personal records</SectionLabel>
      <EmptyState
        icon="trophy-outline"
        message="PRs are caught automatically while you log — true 1RMs, rep maxes and estimated 1RMs, each listed here by exercise."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    // Leaves room on the right for the floating profile button every tab screen shows.
    paddingRight: GEAR_SIZE + spacing.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radii.round,
    borderWidth: 2,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surfaceDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  gear: {
    width: GEAR_SIZE,
    height: GEAR_SIZE,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  count: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
  },
  countValue: {
    ...type.statValue,
  },
  sectionLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
});
