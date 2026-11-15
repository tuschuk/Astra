/**
 * UserCard — one lifter in a list of people (today: the Find lifters search).
 *
 * What it shows: their profile photo (or letter avatar), display name and @username, and a
 * Follow / Following button.
 *
 * What the user can do: tap the card to open the lifter's profile (B25), and tap Follow to follow
 * them or Following to unfollow (the button keeps its own press — `FollowButton`: it flips at once
 * and flips back with a short message if the server refuses, e.g. a block, or the connection
 * drops). Following is one way (SOC-7) — no request, no approval.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/social/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { Body } from '@/components/ui/Text';
import type { FollowResult, LifterResult } from '@/social/follows';
import { personLabels } from '@/social/names';
import { colors, radii, spacing } from '@/theme';

interface UserCardProps {
  lifter: LifterResult;
  /** Follow (`true`) or unfollow (`false`) this lifter; resolves to how it went. */
  onSetFollowing: (following: boolean) => Promise<FollowResult>;
  /** Opens this lifter's profile (B25). Left out, the card isn't tappable. */
  onOpenProfile?: () => void;
}

export function UserCard({ lifter, onSetFollowing, onOpenProfile }: UserCardProps) {
  const who = personLabels(lifter);

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${who.name}’s profile`}
          disabled={!onOpenProfile}
          onPress={onOpenProfile}
          style={styles.person}
        >
          <Avatar path={lifter.avatarPath} initial={who.initial} />
          <View style={styles.text}>
            <Body style={styles.name}>{who.name}</Body>
            {who.handle ? <Body variant="small">{who.handle}</Body> : null}
          </View>
        </Pressable>
        <FollowButton initialFollowing={lifter.following} onSetFollowing={onSetFollowing} />
      </View>
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  person: {
    flex: 1,
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
});
