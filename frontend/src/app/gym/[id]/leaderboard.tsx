/**
 * A gym's leaderboard (B52: GYM-3 part, GYM-6 part, GYM-8, GYM-9 part) — opened from the
 * Leaderboard row on the gym's page.
 *
 * What it shows: the gym's name, three lift chips (Squat, Bench press, Deadlift), and for the
 * chosen lift ALWAYS two sections — "Men" and "Women". Each section lists one row per member:
 * their place, their name, and their best verified weight in the viewer's unit, heaviest first
 * (absolute weight only — no bodyweight, age or weight classes). On equal weights, whoever
 * verified first is placed first. A section with nobody in it says "No verified PRs yet.", so
 * both divisions are visible even on an empty board.
 *
 * What the lifter can do: switch lifts with the chips, tap a name to open that lifter's
 * profile, pull to refresh, and Retry when offline. There is nothing to submit or edit here —
 * entries arrive only through video verification (B53), and the server lets no one write the
 * board. Until B53 lands, every real board is empty.
 *
 * Whose rows appear: whoever verified a lift AT THIS GYM — including members who have since
 * switched gyms or left (their entries stay with the gym they were earned at, GYM-9).
 *
 * Boards live on the server, so the screen needs a connection; without one it says so, with
 * Retry. The chosen lift's board is read when the screen comes into view and whenever its chip
 * is chosen; a lift already read stays on screen (instantly, when you switch back) while the
 * fresh read lands. Pull-to-refresh re-reads the chosen lift.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { GYM_MISSING, GYMS_OFFLINE, loadGym } from '@/social/gyms';
import {
  BOARD_EMPTY,
  DIVISION_LABELS,
  DIVISIONS,
  LIFT_LABELS,
  LIFTS,
  loadBoard,
  splitBoard,
  type DividedBoard,
  type Lift,
  type RankedEntry,
} from '@/social/leaderboards';
import { personLabels } from '@/social/names';
import { useDisplayUnit } from '@/settings/displayUnit';
import { colors, spacing } from '@/theme';
import { formatWeight } from '@/workout/format';

/** The lift chips: one per ranked lift. */
const LIFT_OPTIONS: readonly ChoiceOption<Lift>[] = LIFTS.map((lift) => ({
  value: lift,
  label: LIFT_LABELS[lift],
  spoken: `${LIFT_LABELS[lift]} leaderboard`,
}));

/** One lift's board on screen: loading, loaded, or failed to load. */
type BoardState = { status: 'loading' | 'error' } | { status: 'ready'; board: DividedBoard };

/** The gym's name for the title — or why there is no board to show. */
type GymState = { status: 'loading' | 'error' | 'missing' } | { status: 'ready'; name: string };

export default function GymLeaderboardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = String(id);
  const client = useMemo(() => getSupabase(), []);
  const unit = useDisplayUnit();

  const [gym, setGym] = useState<GymState>({ status: 'loading' });
  const [lift, setLift] = useState<Lift>('squat');
  // Each lift's board, kept once read so switching back is instant.
  const [boards, setBoards] = useState<Partial<Record<Lift, BoardState>>>({});
  const [refreshing, setRefreshing] = useState(false);

  /** Reads the gym's name (and whether it exists). */
  const readGym = useCallback(async () => {
    try {
      const found = await loadGym(client, gymId);
      setGym(found ? { status: 'ready', name: found.name } : { status: 'missing' });
    } catch (error: unknown) {
      console.warn('Leaderboard: the gym could not be loaded', error);
      setGym((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, gymId]);

  /** Reads one lift's board, then splits it into its two divisions. A failure keeps what's shown. */
  const readBoard = useCallback(
    async (which: Lift) => {
      setBoards((prev) => (prev[which]?.status === 'ready' ? prev : { ...prev, [which]: { status: 'loading' } }));
      try {
        const rows = await loadBoard(client, gymId, which);
        setBoards((prev) => ({ ...prev, [which]: { status: 'ready', board: splitBoard(rows) } }));
      } catch (error: unknown) {
        console.warn('Leaderboard: the board could not be loaded', error);
        setBoards((prev) => (prev[which]?.status === 'ready' ? prev : { ...prev, [which]: { status: 'error' } }));
      }
    },
    [client, gymId],
  );

  // Each time the screen comes into view: read the gym's name.
  useFocusEffect(
    useCallback(() => {
      void readGym();
    }, [readGym]),
  );
  // Each time the screen comes into view, and each time a different lift is chosen: read that
  // lift's board. A lift read before stays on screen while it re-reads.
  useFocusEffect(
    useCallback(() => {
      void readBoard(lift);
    }, [readBoard, lift]),
  );

  const current = boards[lift];

  /** Retry after a failure: the gym (if it failed) and the chosen lift. */
  function retry(): void {
    if (gym.status !== 'ready') {
      setGym({ status: 'loading' });
      void readGym();
    }
    void readBoard(lift);
  }

  /** Pull-to-refresh: re-read the chosen lift's board (and the gym, if it hadn't loaded). */
  async function pullToRefresh(): Promise<void> {
    setRefreshing(true);
    await Promise.all([readBoard(lift), gym.status === 'ready' ? Promise.resolve() : readGym()]);
    setRefreshing(false);
  }

  /** Back to the gym page (or Communities, when opened from a link). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/communities');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (gym.status === 'missing') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="barbell-outline" message={GYM_MISSING} />
      </Screen>
    );
  }

  const offline = gym.status === 'error' || current?.status === 'error';

  return (
    <Screen scroll={false}>
      <ScrollView
        testID="gym-leaderboard"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={colors.accent} />}
      >
        {backButton}
        <Heading>{gym.status === 'ready' ? gym.name : 'Leaderboard'}</Heading>
        <Body variant="small" style={styles.subtitle}>
          Best verified PR per member · ranked by weight
        </Body>

        <View style={styles.chips}>
          <ChoiceChips options={LIFT_OPTIONS} selected={lift} onSelect={setLift} fill />
        </View>

        {offline ? (
          <EmptyState icon="cloud-offline-outline" message={GYMS_OFFLINE} actionLabel="Retry" onAction={retry} />
        ) : current?.status !== 'ready' ? (
          <Body variant="muted">Loading the leaderboard…</Body>
        ) : (
          DIVISIONS.map((division) => (
            <View key={division} testID={`division-${division}`} style={styles.division}>
              <SectionLabel accessibilityRole="header">{DIVISION_LABELS[division]}</SectionLabel>
              {current.board[division].length === 0 ? <Body variant="small">{BOARD_EMPTY}</Body> : null}
              {current.board[division].map((entry) => (
                <BoardRow
                  key={entry.id}
                  entry={entry}
                  weight={formatWeight(entry.weightKg, unit)}
                  onOpen={() => router.push({ pathname: '/profile/[id]', params: { id: entry.userId } })}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/** One board row: place, name (tap for their profile) and verified weight. */
function BoardRow({ entry, weight, onOpen }: { entry: RankedEntry; weight: string; onOpen: () => void }) {
  const who = personLabels({ username: entry.username, displayName: entry.displayName });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.rank}. ${who.name}, ${weight}. Open ${who.name}'s profile`}
      onPress={onOpen}
      style={styles.row}
    >
      <Body style={styles.rank}>{entry.rank}</Body>
      <Body style={styles.name} numberOfLines={1}>
        {who.name}
      </Body>
      <Body style={styles.weight}>{weight}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  chips: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  division: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rank: {
    width: 28,
    color: colors.muted,
  },
  name: {
    flex: 1,
    color: colors.text,
  },
  weight: {
    color: colors.text,
  },
});
