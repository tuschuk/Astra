/**
 * Home — the social feed (build-list SOC-1). Until the feed exists, this
 * screen shows the brand and an empty state that points the user at the one
 * real action available today: logging a workout.
 */
import React from 'react';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Heading, SectionLabel } from '@/components/ui/Text';
import { spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Heading size="display">Astra</Heading>
      <SectionLabel style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Your feed
      </SectionLabel>
      <EmptyState
        icon="people-outline"
        message="Workouts, PRs and progress from lifters you follow will show up here. Start by logging your own session."
        actionLabel="Log a workout"
        onAction={() => router.push('/workout')}
      />
    </Screen>
  );
}
