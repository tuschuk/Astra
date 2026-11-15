/**
 * A lifter's profile (B25) — opened by tapping a post card's author on Home, or a card on Find
 * lifters.
 *
 * What it shows: their whole profile (`ProfileView`): photo, name, @username, bio, Followers /
 * Following counts and a Follow / Following button, then their Posts, workout History and PRs —
 * only what the server lets you see (their private workouts and posts never come back). Opening
 * your own id here shows your own profile, with Edit profile instead of Follow.
 *
 * What the user can do: follow or unfollow them, browse the three tabs, and go Back. Reading
 * another lifter's profile needs a connection — their data is never stored on this phone.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProfileView } from '@/components/profile/ProfileView';
import { Button } from '@/components/ui/Button';
import { spacing } from '@/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  /** Back to where the profile was opened from, or Home. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <ProfileView
      // A new id is a different profile: start from scratch rather than show the last one's state.
      key={String(id)}
      profileId={String(id)}
      topBar={<Button label="Back" variant="ghost" onPress={back} style={styles.back} />}
    />
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
});
