/**
 * Communities — Teams (TEAM-1..TEAM-5) and Gyms (GYM-1..GYM-10) live here.
 * Until those ship, each half explains what it is and shows its empty state,
 * so the final two-section structure is in place.
 */
import React from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { spacing } from '@/theme';

export default function CommunitiesScreen() {
  return (
    <Screen>
      <Heading>Communities</Heading>
      <Body variant="muted" style={styles.lede}>
        Train with your people.
      </Body>

      <SectionLabel style={styles.sectionLabel}>Teams</SectionLabel>
      <Card>
        <Body>
          Create a team or join one — share a feed, push programs to members, and let a coach see
          the group&apos;s training.
        </Body>
      </Card>

      <SectionLabel style={styles.sectionLabel}>Gyms</SectionLabel>
      <Card>
        <Body>
          Join your gym to enter its leaderboard: squat, bench and deadlift PRs, video-verified by
          the community.
        </Body>
      </Card>
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
});
