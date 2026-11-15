/**
 * UserCard — one lifter in a list of people (today: the Find lifters search; later the profile
 * screens reuse it).
 *
 * What it shows: a letter avatar, the lifter's display name and @username, and a Follow /
 * Following button.
 *
 * What the user can do: tap Follow to follow them, or Following to unfollow. Following is one
 * way (SOC-7) — no request, no approval. The button flips straight away so it feels instant;
 * if the server refuses (for example, one of you has blocked the other) or the connection
 * drops, it flips back and a short message explains.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LetterAvatar } from '@/components/social/LetterAvatar';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Text';
import type { FollowResult, LifterResult } from '@/social/follows';
import { personLabels } from '@/social/names';
import { colors, radii, spacing } from '@/theme';

interface UserCardProps {
  lifter: LifterResult;
  /** Follow (`true`) or unfollow (`false`) this lifter; resolves to how it went. */
  onSetFollowing: (following: boolean) => Promise<FollowResult>;
}

export function UserCard({ lifter, onSetFollowing }: UserCardProps) {
  const [following, setFollowing] = useState(lifter.following);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const who = personLabels(lifter);

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
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <LetterAvatar initial={who.initial} />
        <View style={styles.text}>
          <Body style={styles.name}>{who.name}</Body>
          {who.handle ? <Body variant="small">{who.handle}</Body> : null}
        </View>
        <Button
          label={following ? 'Following' : 'Follow'}
          variant={following ? 'ghost' : 'primary'}
          onPress={() => void toggle()}
          disabled={busy}
          style={styles.button}
        />
      </View>
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flex: 1,
  },
  name: {
    color: colors.text,
  },
  button: {
    paddingHorizontal: spacing.lg,
  },
  message: {
    color: colors.error,
  },
});
