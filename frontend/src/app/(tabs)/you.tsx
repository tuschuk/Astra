/**
 * You — the profile (YOU-1..YOU-7): photo, name, bio, follower counts,
 * posts, history, PRs and settings. This foundation renders the profile
 * skeleton — avatar ring, counts row, and the PRs section label — in its
 * final layout with empty values, shows which email is signed in, and has
 * the Sign out button (FND-2). Signing out needs no navigation here: the
 * root guard sends the user to sign-in once the session is gone.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { colors, radii, spacing, type } from '@/theme';

/** The two follow counts shown on every profile (YOU-1). */
const COUNTS = [
  { label: 'Followers', value: 0 },
  { label: 'Following', value: 0 },
] as const;

export default function YouScreen() {
  const { session, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  /** Signs out of this device; shows an error only if that somehow fails. */
  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    const result = await signOut();
    setSigningOut(false);
    if (!result.ok) setSignOutError(result.message);
  };

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
          <Body variant="small">{session?.user.email ?? 'Signed in'}</Body>
        </View>
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

      <Button
        label="Sign out"
        variant="ghost"
        onPress={handleSignOut}
        disabled={signingOut}
        style={styles.signOut}
      />
      <FormError message={signOutError} style={styles.error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
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
  signOut: {
    marginTop: spacing.xxl,
  },
  error: {
    marginTop: spacing.sm,
  },
});
