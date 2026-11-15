/**
 * You — the signed-in lifter's own profile (YOU-1, YOU-2, YOU-3; B25).
 *
 * What it shows: the whole profile (`ProfileView`) for the signed-in lifter — photo, name, bio,
 * Followers / Following counts, an Edit profile button, and the Posts / History / PRs tabs. Your
 * own History and PRs come from the phone, so they work offline; your name, bio and photo are
 * remembered on the phone too.
 *
 * The gear button at the top opens Settings (B15), where the lifter picks kg or lb, sees which
 * email is signed in, and signs out — the account's one home.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/auth/AuthProvider';
import { ProfileView } from '@/components/profile/ProfileView';
import { Screen } from '@/components/Screen';
import { Body } from '@/components/ui/Text';
import { colors, layout, radii, spacing } from '@/theme';

/** Size of the round gear button: the platform's minimum touch target. */
const GEAR_SIZE = layout.minTouchTarget;

export default function YouScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const gear = (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
      >
        <Ionicons name="settings-outline" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );

  // Only reachable for a moment while signing out (the guard then leaves this screen).
  if (!me) {
    return (
      <Screen>
        {gear}
        <Body variant="muted">Signing out…</Body>
      </Screen>
    );
  }
  return <ProfileView profileId={me} topBar={gear} />;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    // Leaves room on the right for the floating profile button every tab screen shows.
    paddingRight: GEAR_SIZE + spacing.sm,
    justifyContent: 'flex-end',
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
});
