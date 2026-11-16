/**
 * ExerciseHistorySection — the lifter's own records and logged history for one exercise
 * (LOG-4, LIB-4). The one place that reads and draws them, so the per-exercise history screen and
 * the Library's exercise card can never show different numbers.
 *
 * What it shows, all read from the phone's database (so it works with no signal):
 *   - optionally the exercise's name as a heading (the history screen wants it; the Library card
 *     already has its own);
 *   - a "Current PRs" card with each record book's best ("1RM 140 kg · e1RM 151.7 kg · 5RM 130 kg";
 *     the e1RM is an Epley estimate) or "No PRs yet";
 *   - one card per finished workout that included the exercise, newest first, headed by the
 *     workout's title or date, listing that exercise's sets in order — warm-ups marked "W", a drop
 *     set as one numbered row with its drops joined by arrows (the same set text as the saved
 *     workout).
 *
 * What the lifter can do: read it, and tap "Show older sessions" to reveal the next batch when the
 * list may go further back — tapping until the button disappears reaches every session they ever
 * logged of this movement. If the phone's database can't be read it says so in one line, and
 * whatever screen it sits on keeps working.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { PersonalRecordRow } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { formatDropSet, formatPrLine, groupDropSets, spokenSetLabel, workoutDateLabel } from '@/workout/format';
import {
  EXERCISE_SESSION_LIMIT,
  exerciseInfo,
  exerciseSessions,
  type ExerciseSession,
} from '@/workout/history';
import { currentPrs } from '@/workout/prs';
import { colors, spacing, type } from '@/theme';

export interface ExerciseHistorySectionProps {
  /** The exercise's id in the phone's database (for a library exercise, `libraryExerciseId(slug)`). */
  exerciseId: string;
  /** Draw the exercise's name as a heading above the records (the history screen does). */
  showName?: boolean;
  /** How many sessions each batch adds; the default is the history screen's 50. Tests shrink it. */
  pageSize?: number;
}

/** Everything one read returns for the exercise. */
interface ExerciseHistory {
  name: string | null;
  prs: PersonalRecordRow[];
  sessions: ExerciseSession[];
}

/** Reading, read, or the read failed. */
type LoadState = { status: 'loading' } | { status: 'found'; history: ExerciseHistory } | { status: 'failed' };

/**
 * Draws the signed-in lifter's records and sessions for one exercise.
 *
 * Input: the exercise's database id, whether to head it with the exercise's name, and how many
 * sessions each "Show older sessions" tap adds. Output: the PR card, the session cards and the
 * show-more button — or a loading or failure line while the phone's database can't answer.
 * It exists so every screen that shows a lifter's history of a movement shows the same numbers,
 * read by the same functions (`currentPrs`, `exerciseSessions`) and printed the same way.
 */
export function ExerciseHistorySection({
  exerciseId,
  showName = false,
  pageSize = EXERCISE_SESSION_LIMIT,
}: ExerciseHistorySectionProps) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();

  // How many sessions the lifter has asked to see, remembered per exercise so opening another
  // exercise starts again from one batch.
  const [requested, setRequested] = useState<{ forId: string; limit: number } | null>(null);
  const limit = requested && requested.forId === exerciseId ? requested.limit : pageSize;

  // The last finished read, tagged with the exercise and limit it was for. Keyed by exercise id,
  // so a reused screen never shows the previous exercise's rows while loading; but a bigger limit
  // for the same exercise keeps the current list on screen until the longer one arrives.
  const [loaded, setLoaded] = useState<{ forId: string; limit: number; state: LoadState } | null>(null);
  const current = loaded && loaded.forId === exerciseId ? loaded : null;
  const state: LoadState = current ? current.state : { status: 'loading' };

  useEffect(() => {
    if (!db || !userId) return;
    let cancelled = false;
    Promise.all([
      // The name is only read when it will be drawn (the Library card has its own).
      showName ? exerciseInfo(db, userId, exerciseId) : Promise.resolve(null),
      currentPrs(db, userId, exerciseId),
      exerciseSessions(db, userId, exerciseId, limit),
    ])
      .then(([info, prs, sessions]) => {
        if (!cancelled) {
          setLoaded({
            forId: exerciseId,
            limit,
            state: { status: 'found', history: { name: info?.name ?? null, prs, sessions } },
          });
        }
      })
      .catch((caught: unknown) => {
        console.warn('Exercise history: could not read it from the phone', caught);
        if (cancelled) return;
        // If the list was already on screen and only the "older sessions" read failed, keep what
        // the lifter was reading (the button stays hidden for this attempt) rather than replacing
        // their PRs and sessions with a failure line.
        setLoaded((previous) =>
          previous && previous.forId === exerciseId && previous.state.status === 'found'
            ? { ...previous, limit }
            : { forId: exerciseId, limit, state: { status: 'failed' } },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, exerciseId, limit, showName]);

  if (state.status !== 'found') {
    return state.status === 'failed' || dbError ? (
      <EmptyState icon="barbell-outline" message="This exercise’s history couldn’t be read." />
    ) : (
      <Body variant="muted">Loading history…</Body>
    );
  }

  const { name, prs, sessions } = state.history;
  const prLine = formatPrLine(prs, unit);
  // A full batch means older sessions may exist. Hidden while the longer read is still running
  // (the shown list is for a smaller limit than the one asked for), so it can't be double-tapped.
  const mayHaveOlder = current !== null && current.limit === limit && sessions.length >= limit;

  return (
    <>
      {showName ? <Heading>{name ?? 'Exercise'}</Heading> : null}

      <Card style={styles.card}>
        <SectionLabel size="small" accessibilityRole="header">
          Current PRs
        </SectionLabel>
        <Body>{prLine !== '' ? prLine : 'No PRs yet'}</Body>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState icon="time-outline" message="No finished sessions of this exercise yet." />
      ) : (
        sessions.map((s) => (
          <Card key={s.workoutId} style={styles.card}>
            <Body accessibilityRole="header" style={styles.sessionTitle}>
              {s.title ?? workoutDateLabel(s.startedAt)}
            </Body>
            {s.title ? (
              <Body variant="small" style={styles.muted}>
                {workoutDateLabel(s.startedAt)}
              </Body>
            ) : null}
            {groupDropSets(s.sets).map((segments, index) => (
              /* One utterance per set for screen readers; a drop set's arrows are spoken as "then". */
              <View
                key={segments[0].id}
                style={styles.setRow}
                accessible
                accessibilityLabel={spokenSetLabel(index + 1, segments, unit)}
              >
                <SectionLabel size="small" style={styles.setNumber}>
                  Set {index + 1}
                </SectionLabel>
                <Body style={styles.setText}>{formatDropSet(segments, unit)}</Body>
              </View>
            ))}
          </Card>
        ))
      )}

      {mayHaveOlder ? (
        <Button
          label="Show older sessions"
          variant="ghost"
          onPress={() => setRequested({ forId: exerciseId, limit: limit + pageSize })}
          style={styles.more}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sessionTitle: {
    ...type.cardTitle,
  },
  muted: {
    color: colors.muted,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setNumber: {
    // minWidth: at large text sizes "SET 10" grows instead of clipping.
    minWidth: 48,
  },
  setText: {
    flex: 1,
  },
  more: {
    marginTop: spacing.md,
  },
});
