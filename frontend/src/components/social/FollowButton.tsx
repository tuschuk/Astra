/**
 * FollowButton — the Follow / Following button, with the message line under it when a follow
 * doesn't go through. Shared by the user cards on Find lifters and the header of another lifter's
 * profile (B25), so both behave the same.
 *
 * What the user can do: tap Follow to follow, Following to unfollow (SOC-7: one way, no approval).
 * The button flips straight away so it feels instant; if the server refuses (one of you has
 * blocked the other) or the connection drops, it flips back and a short message explains.
 * `onSettled` hears about every change that went through — the profile uses it to re-read its
 * counts, so the number never contradicts the button.
 */
import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Text';
import type { FollowResult } from '@/social/follows';
import { colors, spacing } from '@/theme';

interface FollowButtonProps {
  /** Whether the viewer follows them when the button first shows. */
  initialFollowing: boolean;
  /** Follow (`true`) or unfollow (`false`); resolves to how it went. */
  onSetFollowing: (following: boolean) => Promise<FollowResult>;
  /** Told after a change the server accepted (the profile re-reads its counts). */
  onSettled?: () => void;
  /** Placement from the screen that holds the button (its margins). */
  style?: StyleProp<ViewStyle>;
}

export function FollowButton({ initialFollowing, onSetFollowing, onSettled, style }: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Flips the button at once, asks the server, and flips back with a message if it said no. */
  async function toggle(): Promise<void> {
    const next = !following;
    setFollowing(next);
    setMessage(null);
    setBusy(true);
    const result = await onSetFollowing(next);
    setBusy(false);
    if (!result.ok) {
      setFollowing(!next);
      setMessage(result.message);
      return;
    }
    onSettled?.();
  }

  return (
    <View style={[styles.root, style]}>
      <Button
        label={following ? 'Following' : 'Follow'}
        variant={following ? 'ghost' : 'primary'}
        onPress={() => void toggle()}
        disabled={busy}
        style={styles.button}
      />
      {message ? (
        <Body variant="small" style={styles.message}>
          {message}
        </Body>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
    alignItems: 'flex-end',
  },
  button: {
    paddingHorizontal: spacing.lg,
  },
  message: {
    color: colors.error,
    maxWidth: 220,
    textAlign: 'right',
  },
});
