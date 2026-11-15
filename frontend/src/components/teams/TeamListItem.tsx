/**
 * TeamListItem — one team as a row (B36): used by Communities (Your teams, Invites, Find teams)
 * and the profile's Teams section.
 *
 * What it shows: the team's name, and under it how it lets people in ("Open" / "Invite only"),
 * plus the viewer's role in it when one is given ("Owner" / "Member").
 *
 * What the user can do: tap the row to open the team's page. A row may also carry one or two
 * buttons on the right (e.g. Join, or Join / Decline on an invite); those act without opening
 * the page.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Text';
import { joinModeLabel, roleLabel, type Team, type TeamRole } from '@/social/teams';
import { colors, radii, spacing } from '@/theme';

/** A button on the row's right side. */
export interface TeamRowAction {
  /** The button's text; a screen reader hears "<label> <team name>". */
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

interface TeamListItemProps {
  team: Pick<Team, 'id' | 'name' | 'joinMode'>;
  /** The viewer's role in this team, shown after the mode; null or absent shows none. */
  role?: TeamRole | null;
  onPress: () => void;
  actions?: readonly TeamRowAction[];
}

export function TeamListItem({ team, role = null, onPress, actions = [] }: TeamListItemProps) {
  const details = [joinModeLabel(team.joinMode), role ? roleLabel(role) : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open team ${team.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <Body style={styles.name}>{team.name}</Body>
        <Body variant="small">{details}</Body>
      </Pressable>
      {actions.map((action) => (
        <Button
          key={action.label}
          label={action.label}
          variant="ghost"
          accessibilityLabel={`${action.label} ${team.name}`}
          onPress={action.onPress}
          disabled={action.disabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  main: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
});
